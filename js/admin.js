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
  // Start the heartbeat poller IMMEDIATELY, before any other init work.
  // Previously this lived at the end of init() — meaning a failure
  // anywhere above (Gmail token check, restoreChipStates, etc.) would
  // silently leave the page stuck on "Checking…" forever. Boot the
  // status loop first so even partial init failures still show a
  // working status card.
  try{ startServerHeartbeat(); }catch(e){ console.warn('[ingest] heartbeat boot:', e); }
  try{
  // ── PASTE TEXT ──
  document.getElementById('ingestTextBtn')?.addEventListener('click',ingestText);

  // ── EMAIL & DOCUMENTS ──
  document.getElementById('gmailConnectBtn')?.addEventListener('click',connectGmail);
  document.getElementById('gmailSyncBtn')?.addEventListener('click',syncEmails);
  document.getElementById('reIngestBtn')?.addEventListener('click',reIngestArchived);

  // ── UNIVERSAL DROP ZONE ──
  function routeFiles(files){
    const emailFiles=[],docFiles=[];
    for(const f of files){
      const ext=(f.name.split('.').pop()||'').toLowerCase();
      if(['eml','mbox','msg'].includes(ext))emailFiles.push(f);
      else if(ext==='xml'){
        // Peek first 2KB to detect SMS backup — don't load 3GB into memory
        f.slice(0,2048).text().then(peek=>{
          if(peek.includes('<smses')||peek.includes('<sms '))ingestSmsStreamed(f);
          else{docFiles.push(f);if(docFiles.length)processDocFiles(docFiles);}
        });continue;
      }
      else if(ext==='txt'){
        // Peek first 2KB to detect WhatsApp
        f.slice(0,2048).text().then(peek=>{
          const waTest=/^\[?\d{1,2}\/\d{1,2}\/\d{2,4},?\s*\d{1,2}:\d{2}/m;
          if(waTest.test(peek))ingestWhatsAppStreamed(f);
          else{
            // Small file — safe to read fully
            if(f.size<50*1024*1024){
              f.text().then(text=>{
                const email=parseEml(text);
                if(email&&email.from)processEmailFiles([f]);
                else processDocFiles([f]);
              });
            }else processDocFiles([f]);
          }
        });continue;
      }
      else if(['pdf','docx','xlsx','xls','csv','md','json'].includes(ext))docFiles.push(f);
      else emailFiles.push(f);
    }
    if(emailFiles.length)processEmailFiles(emailFiles);
    if(docFiles.length)processDocFiles(docFiles);
  }
  const dropzone=document.getElementById('emailDropzone');
  const fileInput=document.getElementById('emailFileInput');
  if(dropzone){
    dropzone.addEventListener('dragover',e=>{e.preventDefault();dropzone.classList.add('dragover');});
    dropzone.addEventListener('dragleave',()=>dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop',e=>{e.preventDefault();dropzone.classList.remove('dragover');routeFiles(e.dataTransfer.files);});
    dropzone.addEventListener('click',e=>{
      if(e.target.tagName==='INPUT')return; // Don't double-trigger
      fileInput?.click();
    });
    fileInput?.addEventListener('change',()=>{if(fileInput.files.length){routeFiles(fileInput.files);fileInput.value='';}});
  }

  // ── TOOLS & BACKUP ──
  document.getElementById('exportBtn')?.addEventListener('click',exportBackup);
  document.getElementById('sensitiveBtn')?.addEventListener('click',scanSensitive);
  document.getElementById('relationshipBtn')?.addEventListener('click',()=>buildRelationships(false));
  document.getElementById('dedupBtn')?.addEventListener('click',findDuplicates);
  document.getElementById('digestBtn')?.addEventListener('click',generateDigest);
  document.getElementById('remindersBtn')?.addEventListener('click',smartReminders);
  document.getElementById('importFileInput')?.addEventListener('change',function(){if(this.files.length)importBackup(this.files[0]);});
  document.getElementById('autoLinkToggle')?.addEventListener('change',e=>{localStorage.setItem('nexus_auto_link',e.target.checked?'on':'off');});

  // ── ACTIVITY LOG ──
  document.getElementById('clearLogBtn')?.addEventListener('click',clearLog);

  // ── WHATSAPP / SMS FILE PICKER ──
  const msgInput=document.getElementById('msgFileInput');
  const msgLabel=document.getElementById('msgFileLabel');
  const msgName=document.getElementById('msgFileName');
  const msgSubmit=document.getElementById('msgSubmitBtn');
  let msgPendingFile=null;
  if(msgInput){
    msgInput.addEventListener('change',()=>{
      if(msgInput.files.length){
        msgPendingFile=msgInput.files[0];
        const sizeMB=(msgPendingFile.size/1024/1024).toFixed(1);
        msgName.textContent=`${msgPendingFile.name} (${sizeMB} MB)`;
        msgLabel.classList.add('has-file');
        msgSubmit.disabled=false;
      }else{
        msgPendingFile=null;
        msgName.textContent='Choose .txt or .xml file…';
        msgLabel.classList.remove('has-file');
        msgSubmit.disabled=true;
      }
    });
  }
  if(msgSubmit){
    msgSubmit.addEventListener('click',async()=>{
      if(!msgPendingFile)return;
      const ext=(msgPendingFile.name.split('.').pop()||'').toLowerCase();
      msgSubmit.disabled=true;msgSubmit.textContent='Reading...';
      const status=document.getElementById('msgFileStatus');
      if(status)status.textContent='';
      try{
        if(ext==='xml'){
          const peek=await msgPendingFile.slice(0,2048).text();
          if(peek.includes('<sms')||peek.includes('<smses')){
            await ingestSmsStreamed(msgPendingFile);
          }else{
            if(status)status.textContent='Not an SMS backup XML file.';
          }
        }else{
          const peek=await msgPendingFile.slice(0,2048).text();
          const waTest=/^\[?\d{1,2}\/\d{1,2}\/\d{2,4},?\s*\d{1,2}:\d{2}/m;
          if(waTest.test(peek)){
            await ingestWhatsAppStreamed(msgPendingFile);
          }else{
            if(status)status.textContent='Not a WhatsApp export file.';
          }
        }
      }catch(e){if(status)status.textContent='Error: '+e.message;}
      msgSubmit.disabled=false;msgSubmit.textContent='Import Messages';
    });
  }

  // ── CONTACTS FILE PICKER ──
  const ctInput=document.getElementById('contactFileInput');
  const ctLabel=document.getElementById('contactFileLabel');
  const ctName=document.getElementById('contactFileName');
  const ctSubmit=document.getElementById('contactSubmitBtn');
  let ctPendingFiles=null;
  if(ctInput){
    ctInput.addEventListener('change',()=>{
      if(ctInput.files.length){
        ctPendingFiles=ctInput.files;
        const names=[...ctInput.files].map(f=>f.name).join(', ');
        ctName.textContent=ctInput.files.length>1?`${ctInput.files.length} files selected`:names;
        ctLabel.classList.add('has-file');
        ctSubmit.disabled=false;
      }else{
        ctPendingFiles=null;
        ctName.textContent='Choose .vcf or .csv file…';
        ctLabel.classList.remove('has-file');
        ctSubmit.disabled=true;
      }
    });
  }
  if(ctSubmit){
    ctSubmit.addEventListener('click',async()=>{
      if(!ctPendingFiles||!ctPendingFiles.length)return;
      ctSubmit.disabled=true;ctSubmit.textContent='Reading...';
      const status=document.getElementById('contactFileStatus');
      if(status)status.textContent='';
      try{
        let allContacts=[];
        for(const file of ctPendingFiles){
          const text=await file.text();
          const ext=(file.name.split('.').pop()||'').toLowerCase();
          if(ext==='vcf')allContacts=allContacts.concat(parseVcf(text));
          else if(ext==='csv')allContacts=allContacts.concat(parseContactsCsv(text));
        }
        if(!allContacts.length){
          if(status)status.textContent='No contacts found in file.';
        }else{
          showContactImportPicker(allContacts);
        }
      }catch(e){if(status)status.textContent='Error: '+e.message;}
      ctSubmit.disabled=false;ctSubmit.textContent='Import Contacts';
    });
  }

  // ── PROCESSOR CONTROLS ──
  document.getElementById('bgProcessToggle')?.addEventListener('change',e=>{
    localStorage.setItem('nexus_bg_process',e.target.checked?'on':'off');
    if(e.target.checked)startBackgroundProcessor();
    else if(bgInterval){clearInterval(bgInterval);bgInterval=null;log('⚙ Processor stopped');}
  });

  // Chip presets — generic handler
  function setupChips(containerId,storageKey,onSelect){
    document.querySelectorAll(`#${containerId} .ig-chip`).forEach(btn=>{
      btn.addEventListener('click',()=>{
        document.querySelectorAll(`#${containerId} .ig-chip`).forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        localStorage.setItem(storageKey,btn.dataset.val);
        if(onSelect)onSelect(btn.dataset.val);
      });
    });
  }
  setupChips('batchPresets','nexus_bg_batch',()=>{if(bgInterval)startBackgroundProcessor();updateProcStatus();});
  setupChips('intervalPresets','nexus_bg_interval',()=>{if(bgInterval)startBackgroundProcessor();updateProcStatus();});
  setupChips('modePresets','nexus_bg_mode',val=>{
    updateProcStatus();
    if(val==='rescan')log('♻ Re-scan mode — archive resets on next cycle');
    if(val==='pull')log('📬 Pull+Process — fetches new Gmail each cycle');
  });

  // Pause button
  document.getElementById('pauseBtn')?.addEventListener('click',function(){
    NX.paused=!NX.paused;
    this.textContent=NX.paused?'⏸ Paused':'● Syncing';
    this.classList.toggle('paused',NX.paused);
  });

  // Run Now
  document.getElementById('procRunNow')?.addEventListener('click',async function(){
    this.disabled=true;this.textContent='Running...';
    await processNextBatch();
    this.disabled=false;this.textContent='▶ Run Batch Now';
  });

  // ── INFO TOOLTIPS — tap to show ──
  document.querySelectorAll('.ig-info').forEach(el=>{
    el.addEventListener('click',e=>{
      e.stopPropagation();
      // Close any open tooltips
      document.querySelectorAll('.ig-info-tip').forEach(t=>t.remove());
      document.querySelectorAll('.ig-info.active').forEach(i=>i.classList.remove('active'));
      // Show this one
      const tip=document.createElement('div');tip.className='ig-info-tip';
      tip.textContent=el.dataset.tip;
      el.classList.add('active');
      el.appendChild(tip);
      // Close on outside tap
      const close=()=>{tip.remove();el.classList.remove('active');document.removeEventListener('click',close);};
      setTimeout(()=>document.addEventListener('click',close),10);
      // Auto-close after 4s
      setTimeout(()=>{try{tip.remove();el.classList.remove('active');}catch(e){}},4000);
    });
  });

  // ── STARTUP ──
  loadGoogleAuth();
  await loadProcessedIds();
  // Gmail connection detection — three-tier:
  //   1. Fresh client token in localStorage? Use it.
  //   2. Server has gmail_refresh_token? We're connected, auto-refresh.
  //   3. Nothing. Show disconnected explicitly.
  const saved=localStorage.getItem('nexus_gmail_token');
  let gmailRestored=false;
  if(saved){
    try{
      const p=JSON.parse(saved);
      if(p.expiry>Date.now()){gmailToken=p.token;showGmailConnected(true);gmailRestored=true;}
      else localStorage.removeItem('nexus_gmail_token');
    }catch(e){}
  }
  if(!gmailRestored){
    // Check server for a stored refresh token — source of truth
    try{
      const{data:status}=await NX.sb.rpc('get_admin_config_status');
      if(status?.gmail_connected){
        const ok=await autoRefreshGmail();
        if(!ok)showGmailDisconnected();
      }else{
        showGmailDisconnected();
      }
    }catch(e){
      showGmailDisconnected();
    }
  }
  // Restore chip states
  restoreChipStates();
  // Background processor is now OPT-IN. Server handles processing via
  // pg_cron every minute, so the client-side processor is redundant for
  // most users. Previously auto-started unless explicitly disabled —
  // that ran a JS interval forever on any open tab. Now requires an
  // explicit toggle-on in the Advanced section.
  if(localStorage.getItem('nexus_bg_process')==='on')startBackgroundProcessor();
  updateProcStatus();
  updateQueueStatus();
  startServerHeartbeat();
  log('Ingest ready','success');
  }catch(e){console.error('INGEST INIT ERROR:',e);log('Init error: '+e.message,'error');}
}

function restoreChipStates(){
  const batch=String(getBatchSize());
  const interval=localStorage.getItem('nexus_bg_interval')||'300';
  const mode=getMode();
  document.querySelectorAll('#batchPresets .ig-chip').forEach(b=>{b.classList.toggle('active',b.dataset.val===batch);});
  document.querySelectorAll('#intervalPresets .ig-chip').forEach(b=>{b.classList.toggle('active',b.dataset.val===interval);});
  document.querySelectorAll('#modePresets .ig-chip').forEach(b=>{b.classList.toggle('active',b.dataset.val===mode);});
}

// ═══ GOOGLE AUTH ═══
function loadGoogleAuth(){const c=NX.getGoogleClientId();if(!c)return;if(!document.querySelector('script[src*="accounts.google.com/gsi/client"]')){const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.onload=()=>initTC();document.head.appendChild(s);}else initTC();}
function initTC(){
  const c=NX.getGoogleClientId();if(!c||!window.google?.accounts?.oauth2)return;gisLoaded=true;
  // Use CODE flow to get a refresh token (persists forever)
  tokenClient=google.accounts.oauth2.initCodeClient({
    client_id:c,
    scope:'https://www.googleapis.com/auth/gmail.readonly',
    access_type:'offline',
    prompt:'consent',
    callback:async r=>{
      if(r.code){
        log('Exchanging auth code for permanent access...');
        try{
          // Send code to gmail-auth edge function
          const resp=await NX.sb.functions.invoke('gmail-auth',{body:{code:r.code}});
          if(resp.data?.access_token){
            gmailToken=resp.data.access_token;
            localStorage.setItem('nexus_gmail_token',JSON.stringify({token:resp.data.access_token,expiry:Date.now()+(resp.data.expires_in||3500)*1000}));
            showGmailConnected(resp.data.has_refresh_token);
            if(resp.data.has_refresh_token){
              log('✓ Gmail connected permanently — will auto-pull emails even without browser','success');
            }else{
              log('✓ Gmail connected (session only — re-authorize for permanent access)','success');
            }
          }else if(resp.data?.error){
            log('Auth error: '+resp.data.error,'error');
          }
        }catch(e){
          log('Auth exchange failed: '+e.message,'error');
          // Fallback to using code directly won't work — need edge function
          log('Deploy the gmail-auth edge function: supabase functions deploy gmail-auth','warn');
        }
      }
    }
  });
}
function connectGmail(){const c=NX.getGoogleClientId();if(!c){log('No Google Client ID. Open Admin ⚙.','error');return;}if(!gisLoaded){loadGoogleAuth();setTimeout(connectGmail,1000);return;}if(tokenClient)tokenClient.requestCode();}

async function autoRefreshGmail(){
  try{
    const resp=await NX.sb.functions.invoke('gmail-auth',{body:{action:'refresh'}});
    if(resp.data?.access_token){
      gmailToken=resp.data.access_token;
      localStorage.setItem('nexus_gmail_token',JSON.stringify({token:resp.data.access_token,expiry:Date.now()+(resp.data.expires_in||3500)*1000}));
      showGmailConnected(true);
      log('Gmail auto-refreshed ✓','success');
      return true;
    }
    // No access token came back — the call succeeded but the server
    // couldn't refresh. Treat as disconnected rather than leaving the
    // UI stuck on "Checking…" indefinitely.
    showGmailDisconnected();
    return false;
  }catch(e){
    // Fetch/edge-function error — also explicit disconnected state so
    // the "Checking…" badge doesn't sit there lying to the user.
    showGmailDisconnected();
    return false;
  }
}

function showGmailConnected(permanent){
  const st=document.getElementById('gmailStatusText');
  if(st){st.textContent=permanent?'✓ Working — auto-syncs new mail':'✓ Connected';st.style.color='#4ade80';}
  const cb=document.getElementById('gmailConnectBtn');
  if(cb)cb.textContent='Reconnect if needed';
  const connectRow=document.getElementById('gmailStatus');
  if(connectRow)connectRow.style.display='none';
  const sc=document.getElementById('gmailSyncControls');
  if(sc)sc.style.display='block';
}

function showGmailDisconnected(){
  const st=document.getElementById('gmailStatusText');
  if(st){st.textContent='Not connected';st.style.color='';}
  const connectRow=document.getElementById('gmailStatus');
  if(connectRow)connectRow.style.display='';
  const sc=document.getElementById('gmailSyncControls');
  if(sc)sc.style.display='none';
  const cb=document.getElementById('gmailConnectBtn');
  if(cb)cb.textContent='Connect Gmail';
}

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

async function syncEmails(){if(!gmailToken){connectGmail();return;}if(NX.paused){log('DB is paused. Resume first.','warn');return;}
isSyncing=true;
const btn=document.getElementById('gmailSyncBtn'),pf=document.getElementById('gmailProgressFill'),pt=document.getElementById('gmailProgressText');document.getElementById('gmailProgress').style.display='flex';btn.disabled=true;btn.textContent='Syncing...';clearLog();log('Starting email sync...');
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

// Save raw emails for future re-ingestion — BATCHED
let savedRaw=0;
const ARCHIVE_BATCH=20;
for(let i=0;i<allEmails.length;i+=ARCHIVE_BATCH){
  if(NX.paused)break;
  const batch=allEmails.slice(i,i+ARCHIVE_BATCH).map(email=>({
    id:email.id,from_addr:email.from,to_addr:email.to,
    date:email.date,subject:email.subject,
    body:email.body,snippet:email.snippet,
    attachment_count:email.attachmentCount,
    attachments:email.attachments.filter(a=>a.url).map(a=>({url:a.url,filename:a.filename,type:a.mimeType})),
    processed:false
  }));
  try{
    const{error}=await NX.sb.from('raw_emails').upsert(batch,{onConflict:'id'});
    if(!error)savedRaw+=batch.length;
    else{log('Archive error: '+error.message,'error');break;}
  }catch(e){log('Archive failed: '+e.message,'error');break;}
  if(i+ARCHIVE_BATCH<allEmails.length)await sleep(300); // Breathe between batches
}
log(`💾 ${savedRaw} emails archived`);

// Queue info
const unprocessed=allEmails.length; // All newly archived are unprocessed
log(`📋 <b>${unprocessed} emails queued</b> for background AI processing (every 5 min, 3 at a time)`);
log('Background processor will extract nodes automatically. No rate limits hit.');
updateQueueStatus();

pf.style.width='100%';pt.textContent='Archived!';
log(`<b>Complete:</b> ${savedRaw} emails archived. Background AI will process them.`,'success');
await NX.loadNodes();if(NX.brain)NX.brain.init();updateStats();}catch(e){log('FATAL: '+e.message,'error');}isSyncing=false;btn.disabled=false;btn.textContent='⚡ Sync Emails → Brain';}

// ═══ BACKGROUND AI PROCESSOR — custom batch/interval ═══
let bgInterval=null,isSyncing=false;
function getBatchSize(){return parseInt(localStorage.getItem('nexus_bg_batch')||'3');}
function getIntervalMs(){return parseInt(localStorage.getItem('nexus_bg_interval')||'300')*1000;}
function getMode(){return localStorage.getItem('nexus_bg_mode')||'process';}
function shouldExtractPdfs(){return document.getElementById('extractPdfs')?.checked!==false;}
function shouldExtractImages(){return document.getElementById('extractImages')?.checked!==false;}
function shouldExtractParts(){return document.getElementById('extractParts')?.checked!==false;}
function shouldAutoLink(){return document.getElementById('extractLinks')?.checked!==false;}

function setProcLive(status,text){
  const dot=document.getElementById('procDot');
  const txt=document.getElementById('procLiveText');
  if(dot){dot.className='ig-proc-dot'+(status==='working'?' working':status==='active'?' active':'');}
  if(txt)txt.textContent=text;
}

// Pull new emails from Gmail in small batches — archive only, no AI
async function pullNewEmails(limit){
  if(!gmailToken){setProcLive('','Gmail not connected');return 0;}
  setProcLive('working','Pulling new emails...');
  try{
    const dv=document.getElementById('gmailDays')?.value||'30';
    const fl=document.getElementById('gmailFilter')?.value?.trim()||'';
    let q='';if(dv!=='all'){const a=new Date();a.setDate(a.getDate()-parseInt(dv));q=`after:${a.getFullYear()}/${a.getMonth()+1}/${a.getDate()}`;}
    if(fl)q+=(q?' ':'')+fl;
    const u=new URL('https://www.googleapis.com/gmail/v1/users/me/messages');
    u.searchParams.set('maxResults',String(Math.min(limit*2,100)));
    if(q)u.searchParams.set('q',q);
    const r=await fetch(u,{headers:{'Authorization':`Bearer ${gmailToken}`}});
    if(r.status===401){gmailToken=null;return 0;}
    const d=await r.json();
    if(!d.messages)return 0;
    // Filter already archived
    const existingIds=new Set();
    try{const{data}=await NX.sb.from('raw_emails').select('id');if(data)data.forEach(e=>existingIds.add(e.id));}catch(e){}
    const newIds=d.messages.map(m=>m.id).filter(id=>!existingIds.has(id)).slice(0,limit);
    if(!newIds.length){log('No new emails to pull');return 0;}
    setProcLive('working',`Fetching ${newIds.length} emails...`);
    let archived=0;
    for(let i=0;i<newIds.length;i+=5){
      const batch=newIds.slice(i,i+5);
      const fetches=batch.map(id=>fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,{headers:{'Authorization':`Bearer ${gmailToken}`}}).then(r=>r.json()).catch(()=>null));
      const results=await Promise.all(fetches);
      const rows=[];
      for(const m of results){
        if(!m||!m.payload)continue;
        const h=m.payload.headers||[],g=n=>(h.find(x=>x.name.toLowerCase()===n.toLowerCase())||{}).value||'';
        let body='';
        function ext(parts){if(!parts)return;for(const p of parts){if(p.mimeType==='text/plain'&&p.body?.data){try{body+=atob(p.body.data.replace(/-/g,'+').replace(/_/g,'/'));}catch(e){}}if(p.parts)ext(p.parts);}}
        if(m.payload.body?.data){try{body=atob(m.payload.body.data.replace(/-/g,'+').replace(/_/g,'/'));}catch(e){}}
        if(!body)ext(m.payload.parts);
        body=cleanEmailBody(body);
        if(isJunkEmail({from:g('From'),subject:g('Subject')}))continue;
        // Collect attachments
        const atts=[];
        function walkAtt(parts){if(!parts)return;for(const p of parts){if(p.filename&&p.body?.attachmentId)atts.push({filename:p.filename,mimeType:p.mimeType,attachmentId:p.body.attachmentId,messageId:m.id});if(p.parts)walkAtt(p.parts);}}
        walkAtt(m.payload.parts);
        // Download attachments
        const savedAtts=[];
        for(const att of atts.slice(0,5)){
          try{
            const ar=await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${att.messageId}/attachments/${att.attachmentId}`,{headers:{'Authorization':`Bearer ${gmailToken}`}});
            if(!ar.ok)continue;const ad=await ar.json();if(!ad.data)continue;
            const bytes=Uint8Array.from(atob(ad.data.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
            const blob=new Blob([bytes],{type:att.mimeType});
            const path=`email-attachments/${Date.now()}_${(att.filename||'file').replace(/[^a-zA-Z0-9._-]/g,'_')}`;
            const{error:ue}=await NX.sb.storage.from('nexus-files').upload(path,blob,{contentType:att.mimeType,upsert:true});
            if(!ue){const{data:ud}=NX.sb.storage.from('nexus-files').getPublicUrl(path);savedAtts.push({url:ud?.publicUrl||'',filename:att.filename,type:att.mimeType});}
          }catch(e){}
        }
        rows.push({id:m.id,from_addr:g('From'),to_addr:g('To'),date:g('Date'),subject:g('Subject'),body:body,snippet:m.snippet||'',attachment_count:atts.length,attachments:savedAtts,processed:false});
      }
      if(rows.length){
        const{error}=await NX.sb.from('raw_emails').upsert(rows,{onConflict:'id'});
        if(!error)archived+=rows.length;
      }
      if(i+5<newIds.length)await sleep(200);
    }
    if(archived)log(`📬 Pulled ${archived} new emails`,'success');
    return archived;
  }catch(e){log('Pull error: '+e.message,'error');return 0;}
}

async function processNextBatch(){
  if(NX.paused||isSyncing)return;
  const mode=getMode();
  const STAGES=['init','pull','fetch','extract','ai','save','link','done'];
  let stage='init',itemsProcessed=0,nodesCreated=0;

  function setStage(s,detail){
    stage=s;
    const stageLabels={init:'Initializing',pull:'Pulling Gmail',fetch:'Fetching queue',extract:'Extracting documents',ai:'AI processing',save:'Saving nodes',link:'Building links',done:'Complete'};
    setProcLive('working',`${stageLabels[s]||s}${detail?' — '+detail:''}`);
  }

  try{
    // ── STAGE: INIT ──
    setStage('init','checking connection');
    const{error:ping}=await NX.sb.from('nexus_config').select('id').eq('id',1).single();
    if(ping){setProcLive('','DB unavailable');return;}
    
    // ── STAGE: RESCAN ──
    if(mode==='rescan'){
      const{count}=await NX.sb.from('raw_emails').select('*',{count:'exact',head:true}).eq('processed',false);
      if(!count||count<1){
        setStage('init','resetting archive');
        await NX.sb.from('raw_emails').update({processed:false}).eq('processed',true);
        log('♻ Archive reset for re-scan','success');
        localStorage.setItem('nexus_bg_mode','process');
        document.querySelectorAll('#modePresets .ig-chip').forEach(b=>{b.classList.toggle('active',b.dataset.val==='process');});
        updateQueueStatus();return;
      }
    }
    
    // ── STAGE: PULL ──
    if(mode==='pull'&&gmailToken){
      setStage('pull','fetching new emails');
      const pulled=await pullNewEmails(getBatchSize());
      if(pulled){log(`📬 ${pulled} new emails pulled`);updateQueueStatus();}
    }

    // ── STAGE: FETCH ──
    setStage('fetch');
    const batchSize=getBatchSize();
    const{data,error}=await NX.sb.from('raw_emails').select('*').eq('processed',false).order('ingested_at',{ascending:true}).limit(batchSize);
    if(error||!data||!data.length){setProcLive('active','Idle — queue empty');updateQueueStatus();return;}
    setStage('fetch',`${data.length} emails`);
    log(`⚙ Batch: ${data.length} emails`);

    const emails=data.map(e=>({
      id:e.id,from:e.from_addr,to:e.to_addr,date:e.date,subject:e.subject,
      body:e.body||'',snippet:e.snippet||'',
      attachmentCount:e.attachment_count||0,attachments:e.attachments||[]
    }));

    // ── STAGE: EXTRACT ──
    setStage('extract');
    let pdfCount=0,imgCount=0,docCount=0;

    for(let ei=0;ei<emails.length;ei++){
      const email=emails[ei];
      if(!email.attachments||!email.attachments.length)continue;

      for(const att of email.attachments){
        if(!att.url)continue;
        const ext=(att.filename||'').split('.').pop().toLowerCase();

        if(ext==='pdf'&&shouldExtractPdfs()&&window.pdfjsLib){
          try{
            setStage('extract',`PDF: ${att.filename}`);
            const resp=await fetch(att.url);if(!resp.ok)continue;
            const buf=await resp.arrayBuffer();
            const pdf=await pdfjsLib.getDocument({data:buf}).promise;
            let pt='';let lowPages=[];
            for(let p=1;p<=Math.min(pdf.numPages,20);p++){
              const pg=await pdf.getPage(p);const c=await pg.getTextContent();
              const pageText=c.items.map(i=>i.str).join(' ').trim();
              pt+=pageText+'\n';
              if(pageText.length<50)lowPages.push(p);
            }
            if(lowPages.length>0&&shouldExtractImages()&&NX.askClaudeVision){
              for(const pn of lowPages.slice(0,4)){
                try{
                  setStage('extract',`OCR page ${pn}: ${att.filename}`);
                  const pg=await pdf.getPage(pn);
                  const vp=pg.getViewport({scale:2});
                  const cv=document.createElement('canvas');cv.width=vp.width;cv.height=vp.height;
                  await pg.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
                  const b64=cv.toDataURL('image/jpeg',0.85).split(',')[1];
                  const vt=await NX.askClaudeVision('Extract ALL text, numbers, dates, amounts, part numbers from this document page. Plain text.',b64,'image/jpeg');
                  if(vt&&vt.length>20){pt+='\n[OCR p'+pn+'] '+vt+'\n';log(`  📖 OCR p${pn}: ${vt.length} chars`);}
                }catch(e){}
              }
            }
            if(pt.length>50){email.body+='\n[PDF:'+att.filename+']\n'+pt.slice(0,5000);pdfCount++;log(`  📎 PDF ${att.filename}: ${pt.length} chars`);}
          }catch(e){log(`  ⚠ PDF failed: ${att.filename}`,'warn');}
        }

        if(['jpg','jpeg','png','webp','gif'].includes(ext)&&shouldExtractImages()){
          try{
            setStage('extract',`Image: ${att.filename}`);
            const resp=await fetch(att.url);if(!resp.ok)continue;
            const blob=await resp.blob();if(blob.size>5*1024*1024)continue;
            const b64=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result.split(',')[1]);fr.readAsDataURL(blob);});
            const mt=blob.type||'image/jpeg';
            const vr=await NX.askClaudeVision('Extract ALL text, numbers, items, prices, totals, dates, vendor names, part numbers, model numbers from this image. If equipment photo: brand, model, condition, serial numbers. Plain text only.',b64,mt);
            if(vr&&vr.length>20){email.body+='\n[IMAGE:'+att.filename+']\n'+vr.slice(0,2000);imgCount++;log(`  🖼 Image ${att.filename}`);}
          }catch(e){log(`  ⚠ Image failed: ${att.filename}`,'warn');}
        }

        // ── MarkItDown: Word, Excel, PPT, HTML, CSV via Edge Function ──
        if(['docx','xlsx','xls','pptx','ppt','html','htm','csv'].includes(ext)){
          try{
            setStage('extract',`MarkItDown: ${att.filename}`);
            // First extract raw text client-side
            let rawText='';
            if((ext==='docx')&&window.mammoth){
              const resp=await fetch(att.url);if(resp.ok){const buf=await resp.arrayBuffer();const r=await mammoth.extractRawText({arrayBuffer:buf});rawText=r.value||'';}
            }else if((ext==='xlsx'||ext==='xls')&&window.XLSX){
              const resp=await fetch(att.url);if(resp.ok){const buf=await resp.arrayBuffer();const wb=XLSX.read(buf,{type:'array',cellDates:true});wb.SheetNames.forEach(name=>{rawText+=`[Sheet: ${name}]\n`+XLSX.utils.sheet_to_csv(wb.Sheets[name])+'\n\n';});}
            }else if(ext==='csv'||ext==='html'||ext==='htm'){
              const resp=await fetch(att.url);if(resp.ok)rawText=await resp.text();
              if(ext==='html'||ext==='htm'){const d=document.createElement('div');d.innerHTML=rawText;rawText=d.textContent||d.innerText||'';}
            }else{
              // pptx or unsupported — try raw text fetch
              try{const resp=await fetch(att.url);if(resp.ok)rawText=await resp.text();}catch(e){}
            }
            if(rawText.length>30){
              // Send to MarkItDown edge function for clean structured extraction
              try{
                const mdResp=await NX.sb.functions.invoke('markitdown',{body:{content:rawText.slice(0,30000),filename:att.filename,mode:'extract'}});
                if(mdResp.data?.markdown){
                  email.body+='\n[DOC:'+att.filename+']\n'+mdResp.data.markdown.slice(0,5000);
                  docCount++;log(`  📄 MarkItDown ${att.filename}: ${mdResp.data.chars} chars`,'success');
                }
              }catch(mdErr){
                // Fallback: use raw text directly
                email.body+='\n[DOC:'+att.filename+']\n'+rawText.slice(0,5000);
                docCount++;log(`  📄 Raw extract ${att.filename}: ${rawText.length} chars`);
              }
            }
          }catch(e){log(`  ⚠ Doc failed: ${att.filename}`,'warn');}
        }
      }
    }
    if(pdfCount||imgCount||docCount)log(`  Extracted: ${pdfCount} PDFs, ${imgCount} images, ${docCount} docs`);

    // ── STAGE: AI ──
    setStage('ai','grouping threads');
    const grouped=[];const subjectMap=new Map();
    for(const e of emails){
      const cleanSubj=(e.subject||'').replace(/^(re:|fw:|fwd:)\s*/gi,'').trim().toLowerCase().slice(0,60);
      if(cleanSubj.length>5&&subjectMap.has(cleanSubj)){subjectMap.get(cleanSubj).push(e);}
      else{const group=[e];if(cleanSubj.length>5)subjectMap.set(cleanSubj,group);grouped.push(group);}
    }
    const processed=grouped.map(group=>{
      if(group.length>1){
        return{...group[0],body:group.map((e,i)=>`[Part ${i+1}] ${e.from} (${e.date}):\n${e.body}`).join('\n---\n'),subject:group[0].subject+` (${group.length} thread emails)`};
      }return group[0];
    });

    const chunk=processed.map((e,idx)=>`[EMAIL #${idx+1}]\nFROM: ${e.from}\nDATE: ${e.date}\nSUBJECT: ${e.subject}\n---\n${e.body||e.snippet}`).join('\n\n========\n\n');
    const sourceMap=processed.map((e,idx)=>({ref:idx+1,from:e.from,date:e.date,subject:e.subject,body:(e.body||e.snippet||'').slice(0,500),attachments:e.attachments||[]}));

    setStage('ai',`analyzing ${processed.length} emails`);
    const r=await aiProcessWithSources(chunk,sourceMap);

    // ── STAGE: SAVE ──
    setStage('save');
    if(r){nodesCreated=await saveExtracted(r);}

    for(const d of data){
      try{await NX.sb.from('raw_emails').update({processed:true}).eq('id',d.id);itemsProcessed++;}
      catch(e){log(`  ⚠ Failed to mark processed: ${d.id}`,'warn');}
      await sleep(50);
    }

    // ── STAGE: LINK ──
    if(nodesCreated&&shouldAutoLink()){
      setStage('link','connecting nodes');
    }

    // ── STAGE: DONE ──
    setStage('done');
    const summary=[];
    if(nodesCreated)summary.push(`${nodesCreated} nodes`);
    if(pdfCount)summary.push(`${pdfCount} PDFs`);
    if(imgCount)summary.push(`${imgCount} images`);
    if(docCount)summary.push(`${docCount} docs`);
    log(`✓ Batch complete: ${itemsProcessed} emails → ${summary.join(', ')||'no new data'}`,'success');
    if(NX.syslog&&(nodesCreated||pdfCount||imgCount||docCount))NX.syslog('batch_complete',`${itemsProcessed} emails → ${summary.join(', ')}`);
    setProcLive('active',summary.length?summary.join(', '):'Queue processed');

    await NX.loadNodes();if(NX.brain)NX.brain.init();
    updateQueueStatus();
    // Stage R: pulse the mini-galaxy if we actually created something.
    // Ingestion is where the brain literally grows — galaxy should shine.
    if ((nodesCreated || pdfCount || imgCount || docCount) && NX.homeGalaxyPulse) {
      NX.homeGalaxyPulse();
    }
  }catch(e){
    log(`⚙ Error at ${stage}: ${e.message}`,'error');
    setProcLive('',`Error: ${stage}`);
    if(NX.toast)NX.toast(`Pipeline failed at ${stage}`,'error');
  }
}
function startBackgroundProcessor(){
  if(bgInterval){clearInterval(bgInterval);bgInterval=null;}
  const ms=getIntervalMs();const batch=getBatchSize();
  log(`⚙ Background processor: ${batch} emails every ${ms/1000}s`);
  setTimeout(()=>processNextBatch(),30000);
  bgInterval=setInterval(processNextBatch,ms);
  updateProcStatus();
}

function updateProcStatus(){
  const batch=getBatchSize();const sec=parseInt(localStorage.getItem('nexus_bg_interval')||'300');
  const mode=getMode();
  const modeLabel=mode==='pull'?'Pull+Process':mode==='rescan'?'Re-scan':'Process';
  const label=document.getElementById('bgProcessLabel');
  if(label)label.textContent=`${modeLabel} (${batch} every ${sec<60?sec+'s':Math.round(sec/60)+'m'})`;
  updateQueueStatus();
}

async function updateQueueStatus(){
  try{
    const{count}=await NX.sb.from('raw_emails').select('*',{count:'exact',head:true}).eq('processed',false);
    const el=document.getElementById('queueStatus');
    const pq=document.getElementById('procQueue');
    if(el){el.textContent=count||0;}
    if(pq)pq.textContent=count>0?`${count} queued`:'';
    // Update stat cards
    const nc=document.getElementById('igNodeCount');
    const ec=document.getElementById('igEmailCount');
    let nodeCount=0,emailCount=0;
    if(nc||ec){
      const r1=await NX.sb.from('nodes').select('*',{count:'exact',head:true});
      const r2=await NX.sb.from('raw_emails').select('*',{count:'exact',head:true});
      nodeCount=r1.count||0;emailCount=r2.count||0;
      if(nc)nc.textContent=nodeCount;
      if(ec)ec.textContent=emailCount;
    }
    // Show contextual guidance
    showGuide(count||0,nodeCount,emailCount);
  }catch(e){}
}

// ── SERVER PIPELINE HEARTBEAT ─────────────────────────────────
// Reads nexus_config.config fields written by process-emails every cron
// run, renders them as a live status line. Polls every 10s while tab is
// visible. Stops polling when backgrounded (Page Visibility API) so we
// don't hammer Supabase with queries from a phone in someone's pocket.
let hbInterval=null;
// Human-readable date formatter. "just now" / "2 min ago" / "1 hour ago"
// Feel free to bump thresholds if they start lying (e.g. 59 seconds
// saying "1 min ago" is fine; 90 seconds saying "1 min ago" is not).
function relativeTime(iso){
  if(!iso)return'never';
  const ms=Date.now()-new Date(iso).getTime();
  if(ms<0)return'just now';
  const s=Math.floor(ms/1000);
  if(s<15)return'just now';
  if(s<60)return`${s} seconds ago`;
  const m=Math.floor(s/60);
  if(m===1)return'1 minute ago';
  if(m<60)return`${m} minutes ago`;
  const h=Math.floor(m/60);
  if(h===1)return'1 hour ago';
  if(h<24)return`${h} hours ago`;
  const d=Math.floor(h/24);
  if(d===1)return'yesterday';
  return`${d} days ago`;
}

// Server status — plain English, answers "is this working?"
// Four states: healthy / stale / broken / unknown.
// Copy is written for a restaurant owner, not a sysadmin.
async function updateServerHeartbeat(){
  const card=document.getElementById('igStatus');
  const dot=document.getElementById('hbDot');
  const line=document.getElementById('hbLine');
  const sub=document.getElementById('hbSub');
  const action=document.getElementById('hbAction');
  if(!card||!dot||!line||!sub)return;
  try{
    const{data:cfg,error}=await NX.sb.rpc('get_admin_config_status');
    if(error)throw error;
    const lastRun=cfg?.last_process_run_at;
    const lastPull=cfg?.last_gmail_pull_at;
    const lastPush=cfg?.gmail_last_push_at;
    const pushStatus=cfg?.gmail_last_push_status;
    const err=cfg?.last_process_error;
    const procStatus=cfg?.last_process_status;
    const newest=[lastRun,lastPull,lastPush].filter(Boolean).sort().pop();

    card.className='ig-status';
    action.style.display='none';
    action.innerHTML='';

    // Never run — new setup, or no activity tracked yet
    if(!newest){
      dot.className='ig-status-dot';
      line.textContent='Waiting for first sync';
      sub.textContent='Once an email arrives or you connect Gmail, activity will show here.';
      return;
    }
    const ageMs=Date.now()-new Date(newest).getTime();
    const ageMin=ageMs/60000;

    // Credentials broken — biggest "you need to do something" state
    if(pushStatus==='no_credentials'){
      card.classList.add('is-error');
      dot.className='ig-status-dot is-error';
      line.textContent='Gmail disconnected';
      sub.textContent='NEXUS can\'t read new email until you reconnect Gmail below.';
      return;
    }
    // Processing errored
    if(procStatus==='error'&&err){
      card.classList.add('is-error');
      dot.className='ig-status-dot is-error';
      line.textContent='Something went wrong reading emails';
      sub.textContent=String(err).slice(0,140);
      return;
    }
    // Healthy — last activity in the last 3 minutes
    if(ageMin<3){
      card.classList.add('is-healthy');
      dot.className='ig-status-dot is-healthy';
      line.textContent='Auto-sync is working';
      // Prefer push timestamp language if push is the freshest signal
      const pushIsFresher=lastPush&&(!lastRun||lastPush>lastRun);
      if(pushIsFresher) sub.textContent=`Last email arrived ${relativeTime(lastPush)}.`;
      else sub.textContent=`Last checked ${relativeTime(newest)}.`;
      return;
    }
    // Stale — 3-10 minutes. Probably fine but flag it.
    if(ageMin<10){
      card.classList.add('is-stale');
      dot.className='ig-status-dot is-stale';
      line.textContent='Sync is a little slow';
      sub.textContent=`Last activity ${relativeTime(newest)}. Should catch up shortly.`;
      return;
    }
    // Dead — 10+ minutes with no activity. Actionable.
    card.classList.add('is-error');
    dot.className='ig-status-dot is-error';
    line.textContent='Auto-sync hasn\'t run in a while';
    sub.textContent=`Last activity ${relativeTime(newest)}. If this is unusual, tap below to try again.`;
    action.style.display='block';
    action.innerHTML='<button id="hbRetryBtn">Try to sync now</button>';
    const btn=action.querySelector('#hbRetryBtn');
    if(btn)btn.addEventListener('click',async()=>{
      btn.textContent='Syncing…';
      btn.disabled=true;
      try{
        await NX.sb.functions.invoke('process-emails',{body:{}});
        setTimeout(updateServerHeartbeat,1500);
      }catch(e){
        btn.textContent='Failed — try again';
        btn.disabled=false;
      }
    });
  }catch(e){
    card.className='ig-status is-error';
    dot.className='ig-status-dot is-error';
    line.textContent='Status check failed';
    sub.textContent=(e&&e.message)||'Could not connect to server';
  }
}

// "Since this morning" counters. Queries tickets/kanban_cards/nodes
// for rows created today (local midnight onwards). Fast, cached, and
// written in humane language. Called by the 10s poller.
async function updateTodayStats(){
  const em=document.getElementById('todayEmails');
  const tk=document.getElementById('todayTickets');
  const kn=document.getElementById('todayKnowledge');
  const rawQ=document.getElementById('igRawQueue');
  const rawK=document.getElementById('igRawKnowledge');
  const rawA=document.getElementById('igRawArchived');
  if(!em&&!rawQ)return;
  const midnight=new Date();midnight.setHours(0,0,0,0);
  const midnightIso=midnight.toISOString();
  // Each query is independent — a single failure (missing table, bad
  // column name, RLS deny) shouldn't blank ALL the stats. Wrap each
  // in try/catch and update its DOM node on success. This was the bug
  // making "Since this morning" show three dashes — the whole
  // Promise.all rejected on one bad query.
  async function safeCount(query, el, formatter){
    if(!el)return;
    try{
      const{count,error}=await query;
      if(error)throw error;
      el.textContent=formatter?formatter(count??0):(count??0);
    }catch(e){
      console.warn('[ingest stats]',e.message||e);
      // Leave previous value or 0 rather than blanking with —
      if(el.textContent==='—')el.textContent='0';
    }
  }
  await Promise.all([
    safeCount(NX.sb.from('raw_emails').select('*',{count:'exact',head:true}).gte('ingested_at',midnightIso),em),
    safeCount(NX.sb.from('kanban_cards').select('*',{count:'exact',head:true}).gte('created_at',midnightIso),tk),
    safeCount(NX.sb.from('nodes').select('*',{count:'exact',head:true}).gte('created_at',midnightIso),kn),
    safeCount(NX.sb.from('raw_emails').select('*',{count:'exact',head:true}).eq('processed',false),rawQ,n=>n.toLocaleString()),
    safeCount(NX.sb.from('nodes').select('*',{count:'exact',head:true}),rawK,n=>n.toLocaleString()),
    safeCount(NX.sb.from('raw_emails').select('*',{count:'exact',head:true}),rawA,n=>n.toLocaleString()),
  ]);
  // Update the legacy hidden-stat nodes other code may read, by
  // re-reading from our updated DOM (cheap + always in sync).
  const q=document.getElementById('queueStatus');if(q&&rawQ)q.textContent=rawQ.textContent.replace(/,/g,'');
  const n=document.getElementById('igNodeCount');if(n&&rawK)n.textContent=rawK.textContent.replace(/,/g,'');
  const ec=document.getElementById('igEmailCount');if(ec&&rawA)ec.textContent=rawA.textContent.replace(/,/g,'');
}

// Push notification status card — five states:
//   on:                 Enabled + working. Show status + test button.
//   off (can prompt):   Supported, never asked. Big Enable button.
//   off (asked before): Supported, previously declined. Soft prompt.
//   denied:             Browser permanently denied. Instructions only.
//   ios-install-needed: iOS Safari not in PWA mode. Install instructions.
//   unsupported:        No PushManager. Explain + suggest Chrome/Firefox.
async function updatePushStatus(){
  const sub=document.getElementById('pushStatusSub');
  const body=document.getElementById('pushStatusBody');
  if(!sub||!body)return;
  if(!NX.getPushStatus){
    sub.textContent='Loading…';
    return;
  }
  try{
    const st=await NX.getPushStatus();
    if(!st.supported){
      if(st.iosNeedsInstall){
        sub.textContent='Install to home screen first';
        body.innerHTML=`
          <div class="ig-note">
            <strong>iPhone & iPad:</strong> Apple requires this app to be installed on your home screen before notifications work.
            <ol style="margin:8px 0 0 16px;padding:0;line-height:1.7">
              <li>Tap the <b>Share</b> button in Safari (box with an arrow up)</li>
              <li>Scroll down, tap <b>Add to Home Screen</b></li>
              <li>Open NEXUS from the home screen icon</li>
              <li>Come back here to enable notifications</li>
            </ol>
          </div>`;
      }else{
        sub.textContent='Not supported on this browser';
        body.innerHTML=`<div class="ig-note">Notifications aren't supported in this browser. Try Chrome, Firefox, or Edge.</div>`;
      }
      return;
    }
    if(st.permission==='denied'){
      sub.textContent='Blocked in browser';
      sub.style.color='#e88';
      body.innerHTML=`
        <div class="ig-note">
          Notifications are blocked for this site in your browser settings. To fix:
          <ul style="margin:8px 0 0 16px;padding:0;line-height:1.7">
            <li>Tap the padlock 🔒 in the address bar</li>
            <li>Find <b>Notifications</b> and switch to <b>Allow</b></li>
            <li>Reload the page and come back here</li>
          </ul>
        </div>`;
      return;
    }
    if(st.subscribed&&st.permission==='granted'){
      sub.textContent='✓ On — this device is receiving alerts';
      sub.style.color='#5bba5f';
      body.innerHTML=`
        <div class="ig-note ig-note-good">
          ✓ You'll get a notification when tickets or cards are created. Urgent ones buzz louder.
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button id="pushTestBtn" class="ig-btn-primary" style="flex:1;min-width:140px">Send test notification</button>
          <button id="pushOffBtn" class="ig-btn-outline" style="flex:1;min-width:140px">Turn off</button>
        </div>
        <div id="pushTestResult" class="ig-feedback"></div>`;
      // Wire buttons
      const testBtn=body.querySelector('#pushTestBtn');
      const offBtn=body.querySelector('#pushOffBtn');
      const result=body.querySelector('#pushTestResult');
      if(testBtn)testBtn.addEventListener('click',async()=>{
        testBtn.textContent='Sending…';testBtn.disabled=true;
        const r=await NX.sendTestPush();
        if(r.ok){
          testBtn.textContent='Sent ✓ Watch for the notification';
          setTimeout(()=>{testBtn.textContent='Send test notification';testBtn.disabled=false;},4000);
        }else{
          testBtn.textContent='Failed — try again';testBtn.disabled=false;
          if(result)result.textContent='Error: '+(r.error||'unknown');
        }
      });
      if(offBtn)offBtn.addEventListener('click',async()=>{
        if(!confirm('Stop receiving notifications on this device?'))return;
        offBtn.textContent='Disabling…';offBtn.disabled=true;
        const r=await NX.disablePush();
        if(r.ok)updatePushStatus();
        else{offBtn.textContent='Failed';setTimeout(()=>{offBtn.textContent='Turn off';offBtn.disabled=false;},2000);}
      });
      return;
    }
    // Not subscribed — offer enable button. Copy differs if user declined before.
    const declinedBefore=localStorage.getItem('nexus_push_asked')==='1'&&st.permission==='default';
    sub.textContent=declinedBefore?'Off — tap to enable':'Off';
    sub.style.color='';
    body.innerHTML=`
      <div class="ig-note">
        Get a notification on this device when ${NX.currentUser?.role==='staff'?'urgent':'any'} ticket or card is created.
        ${declinedBefore?'<br><br>You can change your mind anytime.':''}
      </div>
      <button id="pushEnableBtn" class="ig-btn-primary ig-btn-wide" style="margin-top:12px">🔔 Turn on notifications</button>
      <div id="pushEnableResult" class="ig-feedback"></div>`;
    const enableBtn=body.querySelector('#pushEnableBtn');
    const enableResult=body.querySelector('#pushEnableResult');
    if(enableBtn)enableBtn.addEventListener('click',async()=>{
      enableBtn.textContent='Asking browser…';enableBtn.disabled=true;
      const r=await NX.ensurePush({force:true});
      if(r.ok){
        updatePushStatus();
      }else{
        enableBtn.disabled=false;
        if(r.reason==='permission_denied'){
          enableBtn.textContent='Blocked — see browser settings';
        }else if(r.reason==='no_vapid_key'){
          enableBtn.textContent='Server not configured';
          if(enableResult)enableResult.textContent='Admin: add vapid_public_key to nexus_config.config';
        }else if(r.reason&&r.reason.startsWith('permission_')){
          enableBtn.textContent='🔔 Turn on notifications';
        }else{
          enableBtn.textContent='Failed — try again';
        }
      }
    });
  }catch(e){
    sub.textContent='Status unavailable';
    if(body)body.innerHTML=`<div class="ig-note">Could not read notification status: ${escapeHtml(e.message||'unknown')}</div>`;
  }
}

function escapeHtml(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function startServerHeartbeat(){
  if(hbInterval)return;
  updateServerHeartbeat();
  updateTodayStats();
  hbInterval=setInterval(()=>{
    // Skip the DB round trip if the tab isn't visible — user can't see it
    if(typeof document==='undefined'||document.visibilityState==='visible'){
      updateServerHeartbeat();
      updateTodayStats();
    }
  },10000);
  // Refresh immediately when user comes back from background
  if(typeof document!=='undefined'&&!document._nxHbVisBound){
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState==='visible'){
        updateServerHeartbeat();
        updateTodayStats();
      }
    });
    document._nxHbVisBound=true;
  }
}

function showGuide(pending,nodes,archived){
  const el=document.getElementById('igGuide');if(!el)return;
  // Server now handles processing via pg_cron (every minute). Messages
  // here shouldn't scare the user with ETAs based on client-side batch
  // settings — the server rate is fixed and automatic. Only show guide
  // for onboarding (first-time user) or genuine "done" celebrations.
  if(nodes<5&&archived===0){
    el.style.display='';
    el.innerHTML=`<div class="ig-guide-icon">👋</div>
      <div class="ig-guide-body">
        <div class="ig-guide-title">Get started — feed your Brain</div>
        <div class="ig-guide-steps">
          <div class="ig-guide-step"><b>Gmail:</b> Connect below → server auto-syncs new emails in real time</div>
          <div class="ig-guide-step"><b>WhatsApp/SMS:</b> Open the 📱 section → pick a .txt or .xml export</div>
          <div class="ig-guide-step"><b>Files:</b> Drop PDFs, Word, Excel into the upload zone</div>
          <div class="ig-guide-step"><b>Paste:</b> Any notes, transcripts, or vendor info</div>
        </div>
      </div>`;
  }else if(pending===0&&nodes>0){
    el.style.display='';
    el.innerHTML=`<div class="ig-guide-icon">✅</div>
      <div class="ig-guide-body">
        <div class="ig-guide-title">Queue clear — ${nodes} nodes in Brain</div>
        <div class="ig-guide-steps">
          <div class="ig-guide-step">Open the <b>Brain</b> tab to explore your knowledge galaxy.</div>
          <div class="ig-guide-step">Import more anytime — duplicates are skipped automatically.</div>
        </div>
      </div>`;
  }else{
    // Pipeline status card already shows processing state — no need to
    // double-display "ETA ~118 hours" stress messaging. Stay quiet.
    el.style.display='none';
  }
}

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

  log(`<b>${relevant.length} emails</b> queued for background AI processing.`,'success');
  status.textContent=`✓ ${archived} emails queued`;
  updateQueueStatus();
  // Start processor if not already running
  if(localStorage.getItem('nexus_bg_process')==='on')startBackgroundProcessor();
}

// ═══ BACKUP EXPORT — full database dump ═══
async function exportBackup(){
  const btn=document.getElementById('exportBtn');
  btn.disabled=true;btn.textContent='Exporting...';clearLog();log('Exporting all data...');
  try{
    const backup={version:2,exported:new Date().toISOString(),tables:{}};
    const tables=['nodes','kanban_cards','cleaning_logs','daily_logs','contractor_events','chat_history','processed_ids','raw_emails','tickets','nexus_users','nexus_config'];
    for(const table of tables){
      try{
        let all=[];let offset=0;const PAGE=1000;
        while(true){
          const{data,error}=await NX.sb.from(table).select('*').range(offset,offset+PAGE-1);
          if(error||!data||!data.length)break;
          all=all.concat(data);offset+=PAGE;
          if(data.length<PAGE)break;
        }
        backup.tables[table]=all;
        log(`  ✓ ${table}: ${all.length} rows`);
      }catch(e){log(`  ⚠ ${table}: ${e.message}`,'warn');backup.tables[table]=[];}
    }
    // Create downloadable file
    const json=JSON.stringify(backup,null,2);
    const blob=new Blob([json],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download=`nexus-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    URL.revokeObjectURL(url);
    const sizeMB=(json.length/1024/1024).toFixed(1);
    log(`<b>✓ Backup exported</b> (${sizeMB} MB)`,'success');
    if(NX.syslog)NX.syslog('backup_exported',`${sizeMB} MB backup exported`);
    if(NX.toast)NX.toast('Backup downloaded ✓','success');
  }catch(e){log('Export error: '+e.message,'error');}
  btn.disabled=false;btn.textContent='⬇ Export Full Backup';
}

// ═══ BACKUP IMPORT — restore from JSON ═══
async function importBackup(file){
  const status=document.getElementById('importStatus');
  if(!confirm('⚠ This will MERGE data into your current database. Existing data with matching IDs will be overwritten. Continue?'))return;
  status.textContent='Reading file...';clearLog();
  try{
    const text=await file.text();
    const backup=JSON.parse(text);
    if(!backup.tables){status.textContent='Invalid backup file.';return;}
    log(`📦 Backup from ${backup.exported||'unknown'} (v${backup.version||1})`);

    // Import order matters — config first, then users, then data
    const order=['nexus_config','nexus_users','nodes','kanban_cards','cleaning_logs','daily_logs','contractor_events','chat_history','processed_ids','raw_emails','tickets'];
    for(const table of order){
      const rows=backup.tables[table];
      if(!rows||!rows.length){log(`  ⏭ ${table}: empty`);continue;}
      status.textContent=`Importing ${table}...`;
      let imported=0;
      // Batch upsert — 50 at a time
      for(let i=0;i<rows.length;i+=50){
        const batch=rows.slice(i,i+50);
        try{
          // Determine primary key
          const pk=table==='nexus_config'?'id':table==='raw_emails'?'id':'id';
          const{error}=await NX.sb.from(table).upsert(batch,{onConflict:pk,ignoreDuplicates:false});
          if(!error)imported+=batch.length;
          else log(`  ⚠ ${table} batch: ${error.message}`,'warn');
        }catch(e){}
        if(i+50<rows.length)await sleep(200);
      }
      log(`  ✓ ${table}: ${imported}/${rows.length} rows`);
    }

    log(`<b>✓ Import complete</b>`,'success');
    status.textContent='✓ Restored';
    if(NX.toast)NX.toast('Backup restored ✓','success');
    await NX.loadNodes();if(NX.brain)NX.brain.init();
    updateQueueStatus();
  }catch(e){
    log('Import error: '+e.message,'error');
    status.textContent='Error: '+e.message;
  }
}

// ═══ DOCUMENT FILE INGEST — PDF, DOCX, XLSX, CSV ═══
// ═══ DEEP DOCUMENT PARSING ═══

async function extractPdfText(file){
  if(!window.pdfjsLib){log('PDF.js not loaded','error');return'';}
  try{
    const buffer=await file.arrayBuffer();
    const pdf=await pdfjsLib.getDocument({data:buffer}).promise;
    const numPages=Math.min(pdf.numPages,50);
    let allText='';
    let lowTextPages=[];

    // Pass 1: Extract text from all pages
    for(let i=1;i<=numPages;i++){
      const page=await pdf.getPage(i);
      const content=await page.getTextContent();
      const pageText=content.items.map(item=>item.str).join(' ').trim();
      allText+=`[Page ${i}]\n${pageText}\n\n`;
      // Track pages with little/no text (likely scanned or image-heavy)
      if(pageText.length<50)lowTextPages.push(i);
    }

    // Pass 2: Render low-text pages as images → Claude Vision OCR
    if(lowTextPages.length>0&&NX.askClaudeVision){
      const pagesToScan=lowTextPages.slice(0,8); // Max 8 pages via Vision
      log(`  🔍 ${pagesToScan.length} scanned/image pages detected — using Vision OCR`);
      for(const pageNum of pagesToScan){
        try{
          const page=await pdf.getPage(pageNum);
          const viewport=page.getViewport({scale:2}); // 2x for readability
          const canvas=document.createElement('canvas');
          canvas.width=viewport.width;canvas.height=viewport.height;
          const ctx=canvas.getContext('2d');
          await page.render({canvasContext:ctx,viewport}).promise;
          const b64=canvas.toDataURL('image/jpeg',0.85).split(',')[1];
          const visionText=await NX.askClaudeVision(
            'Extract ALL text from this document page. Include every number, word, date, amount, name, address, phone number, part number, serial number. Preserve layout structure (tables, columns, headers). Plain text only.',
            b64,'image/jpeg'
          );
          if(visionText&&visionText.length>20){
            allText+=`[Page ${pageNum} — OCR]\n${visionText}\n\n`;
            log(`  📖 Page ${pageNum}: ${visionText.length} chars via Vision`);
          }
        }catch(e){}
      }
    }

    // Pass 3: Extract embedded images (logos, receipts, photos)
    if(NX.askClaudeVision){
      let imageCount=0;
      for(let i=1;i<=Math.min(numPages,20)&&imageCount<5;i++){
        try{
          const page=await pdf.getPage(i);
          const ops=await page.getOperatorList();
          for(let j=0;j<ops.fnArray.length&&imageCount<5;j++){
            if(ops.fnArray[j]===pdfjsLib.OPS.paintImageXObject){
              const imgName=ops.argsArray[j][0];
              try{
                const img=await page.objs.get(imgName);
                if(!img||!img.width||img.width<100||img.height<100)continue; // Skip tiny images
                const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
                const cx=c.getContext('2d');
                const imgData=cx.createImageData(img.width,img.height);
                // Handle different image data formats
                if(img.data){
                  if(img.data.length===img.width*img.height*4){
                    imgData.data.set(img.data);
                  }else if(img.data.length===img.width*img.height*3){
                    for(let p=0,q=0;p<img.data.length;p+=3,q+=4){
                      imgData.data[q]=img.data[p];imgData.data[q+1]=img.data[p+1];
                      imgData.data[q+2]=img.data[p+2];imgData.data[q+3]=255;
                    }
                  }else continue;
                  cx.putImageData(imgData,0,0);
                  const b64=c.toDataURL('image/jpeg',0.8).split(',')[1];
                  const vt=await NX.askClaudeVision(
                    'Extract ALL text, numbers, dates, amounts, part numbers, names, addresses from this image. If it\'s a logo, identify the company. If a receipt/invoice, extract every line item. Plain text only.',
                    b64,'image/jpeg'
                  );
                  if(vt&&vt.length>15){
                    allText+=`[Embedded Image p${i}]\n${vt}\n\n`;
                    imageCount++;
                    log(`  🖼 Embedded image p${i}: ${vt.length} chars`);
                  }
                }
              }catch(e){}
            }
          }
        }catch(e){}
      }
    }

    return allText.trim();
  }catch(e){log('PDF error: '+e.message,'error');return'';}
}

async function extractDocxText(file){
  if(!window.mammoth){log('Mammoth not loaded','error');return'';}
  try{
    const buffer=await file.arrayBuffer();
    // Extract text
    const result=await mammoth.extractRawText({arrayBuffer:buffer});
    let text=(result.value||'').trim();
    // Also try HTML extraction for tables
    try{
      const htmlResult=await mammoth.convertToHtml({arrayBuffer:buffer});
      if(htmlResult.value){
        // Extract table data from HTML
        const div=document.createElement('div');div.innerHTML=htmlResult.value;
        const tables=div.querySelectorAll('table');
        if(tables.length){
          text+='\n\n[TABLES]\n';
          tables.forEach((t,i)=>{
            text+=`Table ${i+1}:\n`;
            t.querySelectorAll('tr').forEach(r=>{
              const cells=[];r.querySelectorAll('td,th').forEach(c=>cells.push(c.textContent.trim()));
              text+=cells.join(' | ')+'\n';
            });
            text+='\n';
          });
        }
        // Extract images for Vision
        if(NX.askClaudeVision){
          const imgs=div.querySelectorAll('img');
          for(let i=0;i<Math.min(imgs.length,3);i++){
            const src=imgs[i].src;
            if(src&&src.startsWith('data:image')){
              try{
                const b64=src.split(',')[1];const mt=src.split(';')[0].split(':')[1];
                const vt=await NX.askClaudeVision('Extract all text and data from this image.',b64,mt);
                if(vt&&vt.length>15)text+=`\n[Doc Image]\n${vt}\n`;
              }catch(e){}
            }
          }
        }
      }
    }catch(e){}
    return text;
  }catch(e){log('DOCX error: '+e.message,'error');return'';}
}

async function extractXlsxText(file){
  if(!window.XLSX){log('SheetJS not loaded','error');return'';}
  try{
    const buffer=await file.arrayBuffer();
    const wb=XLSX.read(buffer,{type:'array',cellDates:true});
    let text='';
    wb.SheetNames.forEach(name=>{
      const sheet=wb.Sheets[name];
      const range=XLSX.utils.decode_range(sheet['!ref']||'A1');
      const rows=range.e.r-range.s.r+1;
      const cols=range.e.c-range.s.c+1;
      text+=`[Sheet: ${name} — ${rows} rows × ${cols} cols]\n`;
      // Use CSV for structure
      text+=XLSX.utils.sheet_to_csv(sheet)+'\n\n';
      // Also extract any comments/notes
      Object.keys(sheet).forEach(k=>{
        if(sheet[k]&&sheet[k].c&&sheet[k].c.length){
          sheet[k].c.forEach(c=>{if(c.t)text+=`[Note ${k}]: ${c.t}\n`;});
        }
      });
    });
    return text.trim();
  }catch(e){log('XLSX error: '+e.message,'error');return'';}
}

async function processDocFiles(files){
  if(!files||!files.length)return;
  clearLog();
  const status=document.getElementById('docFileStatus');
  status.textContent='Processing...';
  let totalArchived=0;

  for(const file of files){
    const ext=(file.name.split('.').pop()||'').toLowerCase();
    log(`📄 ${file.name} (${(file.size/1024).toFixed(0)}KB)...`);
    let text='';

    if(ext==='pdf')text=await extractPdfText(file);
    else if(ext==='docx')text=await extractDocxText(file);
    else if(ext==='xlsx'||ext==='xls')text=await extractXlsxText(file);
    else if(['csv','txt','md','json'].includes(ext))text=await file.text();
    else{log(`  ⚠ Unsupported: .${ext}`,'warn');continue;}

    if(!text||text.length<20){log(`  ⚠ No usable text`,'warn');continue;}
    log(`  ✓ ${text.length} chars extracted`);

    // Upload to Supabase Storage
    let fileUrl='';
    try{
      const path=`documents/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
      const{error}=await NX.sb.storage.from('nexus-files').upload(path,file,{contentType:file.type,upsert:true});
      if(!error){const{data}=NX.sb.storage.from('nexus-files').getPublicUrl(path);fileUrl=data?.publicUrl||'';log('  📎 Uploaded');}
    }catch(e){}

    // Archive for background AI processing
    try{
      await NX.sb.from('raw_emails').upsert({
        id:'doc_'+Date.now()+'_'+Math.random().toString(36).slice(2,8),
        from_addr:file.name,to_addr:'nexus-import',
        date:new Date().toISOString(),subject:file.name.replace(/\.[^.]+$/,''),
        body:text.slice(0,12000),snippet:text.slice(0,200),
        attachment_count:1,attachments:fileUrl?[{url:fileUrl,filename:file.name,type:file.type}]:[],
        processed:false
      },{onConflict:'id'});
      totalArchived++;
    }catch(e){log('  Archive error: '+e.message,'error');}
  }

  if(totalArchived){
    log(`💾 ${totalArchived} docs queued for AI processing`,'success');
    status.textContent=`✓ ${totalArchived} files queued`;
    updateQueueStatus();
  }else status.textContent='No content found.';
}

// ═══ SLACK IMPORT — parse export JSON or pasted text ═══
const SLACK_SKIP_TYPES=new Set(['channel_join','channel_leave','channel_topic','channel_purpose','bot_message','pinned_item','channel_name','channel_archive']);

// ═══ WHATSAPP EXPORT PARSER ═══
function parseWhatsApp(text){
  const messages=[];
  // WhatsApp format: [MM/DD/YY, HH:MM:SS] Sender: Message
  // Or: MM/DD/YY, HH:MM - Sender: Message
  const lines=text.split('\n');
  const msgRe=/^\[?(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\]?\s*[-–]?\s*(.+?):\s*(.+)/i;
  let current=null;
  for(const line of lines){
    const m=line.match(msgRe);
    if(m){
      if(current)messages.push(current);
      current={date:m[1]+' '+m[2],sender:m[3].trim(),text:m[4].trim()};
    }else if(current&&line.trim()){
      current.text+='\n'+line.trim();
    }
  }
  if(current)messages.push(current);
  // Filter system messages
  return messages.filter(m=>!m.text.includes('created group')&&!m.text.includes('changed the subject')&&!m.text.includes('added ')&&!m.text.includes('left')&&m.text!=='<Media omitted>'&&m.text.length>2);
}

async function ingestWhatsApp(text,filename){
  clearLog();
  const messages=parseWhatsApp(text);
  if(!messages.length){log('No messages found in WhatsApp export.','warn');return;}
  const byContact={};
  messages.forEach(m=>{if(!byContact[m.sender])byContact[m.sender]=[];byContact[m.sender].push(m);});
  log(`📱 WhatsApp: ${messages.length} messages, ${Object.keys(byContact).length} contacts`);
  showContactPicker(byContact,'whatsapp',filename);
}

// ═══ STREAMED FILE READERS — for multi-GB exports ═══

async function ingestWhatsAppStreamed(file){
  clearLog();
  const sizeMB=(file.size/1024/1024).toFixed(0);
  log(`📱 Reading WhatsApp export (${sizeMB} MB)...`);
  setProcLive('working',`Reading ${sizeMB} MB...`);

  const byContact={};
  const msgRe=/^\[?(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\]?\s*[-–]?\s*(.+?):\s*(.+)/i;
  const CHUNK_SIZE=8*1024*1024; // 8MB chunks
  let leftover='';
  let totalMessages=0;
  let current=null;
  let bytesRead=0;

  for(let offset=0;offset<file.size;offset+=CHUNK_SIZE){
    const slice=file.slice(offset,Math.min(offset+CHUNK_SIZE,file.size));
    const text=await slice.text();
    bytesRead+=slice.size;
    const pct=Math.round(bytesRead/file.size*100);
    setProcLive('working',`Reading... ${pct}% (${totalMessages} msgs)`);

    const combined=leftover+text;
    const lines=combined.split('\n');
    // Keep last line as leftover (might be incomplete)
    leftover=lines.pop()||'';

    for(const line of lines){
      const m=line.match(msgRe);
      if(m){
        if(current){
          // Save previous message
          if(!current.text.includes('created group')&&!current.text.includes('changed the subject')&&current.text!=='<Media omitted>'&&current.text.length>2){
            if(!byContact[current.sender])byContact[current.sender]=[];
            byContact[current.sender].push(current);
            totalMessages++;
          }
        }
        current={date:m[1]+' '+m[2],sender:m[3].trim(),text:m[4].trim()};
      }else if(current&&line.trim()){
        current.text+='\n'+line.trim();
      }
    }

    // Yield to UI every chunk
    await new Promise(r=>setTimeout(r,0));
  }
  // Flush remaining
  if(leftover){
    const m=leftover.match(msgRe);
    if(m){if(current){if(!byContact[current.sender])byContact[current.sender]=[];byContact[current.sender].push(current);totalMessages++;}
      current={date:m[1]+' '+m[2],sender:m[3].trim(),text:m[4].trim()};}
    else if(current)current.text+='\n'+leftover.trim();
  }
  if(current&&current.text.length>2){if(!byContact[current.sender])byContact[current.sender]=[];byContact[current.sender].push(current);totalMessages++;}

  setProcLive('active','Read complete');
  if(!totalMessages){log('No messages found.','warn');return;}
  log(`✓ ${totalMessages} messages from ${Object.keys(byContact).length} contacts`,'success');
  showContactPicker(byContact,'whatsapp',file.name);
}

async function ingestSmsStreamed(file){
  clearLog();
  const sizeMB=(file.size/1024/1024).toFixed(0);
  log(`📱 Reading SMS backup (${sizeMB} MB)...`);
  setProcLive('working',`Reading ${sizeMB} MB...`);

  const byContact={};
  const CHUNK_SIZE=8*1024*1024; // 8MB chunks
  let leftover='';
  let totalMessages=0;
  let bytesRead=0;

  // Regex to match complete <sms .../> elements
  const smsRe=/<sms\s+[^>]*?address="([^"]*)"[^>]*?date="(\d+)"[^>]*?body="([^"]*)"[^>]*?(?:contact_name="([^"]*)")?[^>]*?\/>/gi;

  for(let offset=0;offset<file.size;offset+=CHUNK_SIZE){
    const slice=file.slice(offset,Math.min(offset+CHUNK_SIZE,file.size));
    const text=await slice.text();
    bytesRead+=slice.size;
    const pct=Math.round(bytesRead/file.size*100);
    setProcLive('working',`Reading... ${pct}% (${totalMessages} msgs)`);

    const combined=leftover+text;
    // Find last complete <sms .../> — keep anything after as leftover
    let lastClose=combined.lastIndexOf('/>');
    if(lastClose===-1){leftover=combined;continue;}
    lastClose+=2;
    const processable=combined.slice(0,lastClose);
    leftover=combined.slice(lastClose);

    let m;
    smsRe.lastIndex=0;
    while((m=smsRe.exec(processable))!==null){
      const date=new Date(parseInt(m[2]));
      const body=m[3].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#10;/g,'\n');
      if(body.length<3)continue;
      const sender=m[4]||m[1]||'Unknown';
      if(!byContact[sender])byContact[sender]=[];
      byContact[sender].push({sender,phone:m[1],date:date.toLocaleString(),text:body});
      totalMessages++;
    }

    await new Promise(r=>setTimeout(r,0));
  }
  // Process leftover
  if(leftover.length>10){
    let m;smsRe.lastIndex=0;
    while((m=smsRe.exec(leftover))!==null){
      const date=new Date(parseInt(m[2]));
      const body=m[3].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#10;/g,'\n');
      if(body.length<3)continue;
      const sender=m[4]||m[1]||'Unknown';
      if(!byContact[sender])byContact[sender]=[];
      byContact[sender].push({sender,phone:m[1],date:date.toLocaleString(),text:body});
      totalMessages++;
    }
  }

  setProcLive('active','Read complete');
  if(!totalMessages){log('No SMS messages found.','warn');return;}
  log(`✓ ${totalMessages} messages from ${Object.keys(byContact).length} contacts`,'success');
  showContactPicker(byContact,'sms',file.name);
}

// ═══ SMS XML PARSER (small files — kept for direct text input) ═══
function parseSmsXml(text){
  const messages=[];
  const smsRe=/<sms\s+[^>]*?address="([^"]*)"[^>]*?date="(\d+)"[^>]*?body="([^"]*)"[^>]*?(?:contact_name="([^"]*)")?[^>]*?\/>/gi;
  let m;
  while((m=smsRe.exec(text))!==null){
    const date=new Date(parseInt(m[2]));
    const body=m[3].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#10;/g,'\n');
    if(body.length<3)continue;
    messages.push({sender:m[4]||m[1]||'Unknown',phone:m[1],date:date.toLocaleString(),text:body});
  }
  return messages;
}

async function ingestSms(text,filename){
  clearLog();
  const messages=parseSmsXml(text);
  if(!messages.length){log('No SMS messages found in XML.','warn');return;}
  const byContact={};
  messages.forEach(m=>{if(!byContact[m.sender])byContact[m.sender]=[];byContact[m.sender].push(m);});
  log(`📱 SMS: ${messages.length} messages, ${Object.keys(byContact).length} contacts`);
  showContactPicker(byContact,'sms',filename);
}

// ═══ CONTACT PICKER — select which conversations feed the brain ═══
function showContactPicker(byContact,source,filename){
  const contacts=Object.entries(byContact).map(([name,msgs])=>({
    name,count:msgs.length,
    preview:msgs.slice(-1)[0]?.text?.slice(0,60)||'',
    lastDate:msgs.slice(-1)[0]?.date||''
  })).sort((a,b)=>b.count-a.count);

  const overlay=document.createElement('div');overlay.className='board-modal-overlay';
  const icon=source==='whatsapp'?'📱':'💬';
  overlay.innerHTML=`<div class="board-modal" style="max-height:85vh;overflow-y:auto;max-width:400px">
    <div class="board-modal-title">${icon} ${source==='whatsapp'?'WhatsApp':'SMS'} — Select Contacts</div>
    <div style="font-size:11px;color:var(--faint);margin-bottom:10px">${filename} · ${contacts.reduce((a,c)=>a+c.count,0)} total messages</div>
    <div class="cp-actions" style="display:flex;gap:6px;margin-bottom:10px">
      <button class="ig-chip active" id="cpAll">Select All</button>
      <button class="ig-chip" id="cpNone">Select None</button>
    </div>
    <div id="cpList" style="display:flex;flex-direction:column;gap:4px"></div>
    <div class="board-modal-actions" style="margin-top:12px">
      <button class="board-modal-cancel" id="cpCancel">Cancel</button>
      <button class="board-modal-save" id="cpImport">Import Selected</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  const listEl=overlay.querySelector('#cpList');
  contacts.forEach(c=>{
    const row=document.createElement('label');row.className='cp-row';
    row.innerHTML=`<input type="checkbox" checked data-contact="${c.name.replace(/"/g,'&quot;')}">
      <div class="cp-info">
        <div class="cp-name">${c.name} <span class="cp-count">${c.count} msgs</span></div>
        <div class="cp-preview">${c.preview}</div>
      </div>`;
    listEl.appendChild(row);
  });

  overlay.querySelector('#cpAll').addEventListener('click',()=>{overlay.querySelectorAll('#cpList input').forEach(cb=>cb.checked=true);});
  overlay.querySelector('#cpNone').addEventListener('click',()=>{overlay.querySelectorAll('#cpList input').forEach(cb=>cb.checked=false);});
  overlay.querySelector('#cpCancel').addEventListener('click',()=>overlay.remove());
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});

  overlay.querySelector('#cpImport').addEventListener('click',async()=>{
    const selected=new Set();
    overlay.querySelectorAll('#cpList input:checked').forEach(cb=>selected.add(cb.dataset.contact));
    overlay.remove();
    if(!selected.size){log('No contacts selected.','warn');return;}
    // Filter and import only selected contacts
    const filtered={};
    for(const[name,msgs]of Object.entries(byContact)){
      if(selected.has(name))filtered[name]=msgs;
    }
    await importFilteredMessages(filtered,source,filename);
  });
}

async function importFilteredMessages(byContact,source,filename){
  const totalMsgs=Object.values(byContact).reduce((a,msgs)=>a+msgs.length,0);
  const contactNames=Object.keys(byContact);
  log(`Importing ${totalMsgs} messages from ${contactNames.length} contacts...`);

  // Simple stable hash for deterministic IDs
  function hashStr(s){let h=0;for(let i=0;i<s.length;i++){h=((h<<5)-h)+s.charCodeAt(i);h|=0;}return(h>>>0).toString(36);}

  // Build all chunk IDs first, then check which already exist
  const prefix=source==='whatsapp'?'wa':'sms';
  const chunks=[];
  for(const[contact,msgs]of Object.entries(byContact)){
    const CHUNK=source==='whatsapp'?20:30;
    for(let i=0;i<msgs.length;i+=CHUNK){
      const batch=msgs.slice(i,i+CHUNK);
      const body=batch.map(m=>`[${m.date}] ${m.sender}: ${m.text}`).join('\n');
      const firstDate=batch[0]?.date||'';
      const lastDate=batch[batch.length-1]?.date||'';
      // Deterministic ID from content — same messages always produce same ID
      const anchor=`${contact}|${firstDate}|${batch[0]?.text?.slice(0,40)||''}|${batch.length}`;
      const id=`${prefix}_${hashStr(anchor)}_${hashStr(body.slice(0,200))}`;
      chunks.push({id,contact,body,firstDate,lastDate,count:batch.length});
    }
  }

  // Check which chunk IDs already exist in raw_emails
  const existingIds=new Set();
  try{
    const ids=chunks.map(c=>c.id);
    // Check in batches of 50
    for(let i=0;i<ids.length;i+=50){
      const batch=ids.slice(i,i+50);
      const{data}=await NX.sb.from('raw_emails').select('id').in('id',batch);
      if(data)data.forEach(r=>existingIds.add(r.id));
    }
  }catch(e){}

  const newChunks=chunks.filter(c=>!existingIds.has(c.id));
  const skipped=chunks.length-newChunks.length;
  if(skipped)log(`⏭ Skipping ${skipped} already-imported chunks`);
  if(!newChunks.length){log('All messages already imported. No new tokens used.','success');if(NX.toast)NX.toast('Already imported — no duplicates','info');return;}

  let totalArchived=0;
  for(const c of newChunks){
    try{
      await NX.sb.from('raw_emails').upsert({
        id:c.id,
        from_addr:`${source==='whatsapp'?'WhatsApp':'SMS'}: ${c.contact}`,
        to_addr:'nexus-import',
        date:c.firstDate,
        subject:`${source==='whatsapp'?'WhatsApp':'SMS'} with ${c.contact} (${c.firstDate} – ${c.lastDate})`,
        body:c.body.slice(0,12000),
        snippet:c.body.slice(0,200),
        attachment_count:0,attachments:[],processed:false
      },{onConflict:'id'});
      totalArchived++;
    }catch(e){log('Archive error: '+e.message,'error');}
  }
  log(`💾 ${totalArchived} new chunks queued (${skipped} duplicates skipped)`,'success');
  if(NX.toast)NX.toast(`${totalArchived} new chunks imported${skipped?' · '+skipped+' skipped':''}`,'success');
  if(NX.syslog)NX.syslog('whatsapp_import',`${totalArchived} messages imported${skipped?' ('+skipped+' skipped)':''}`);
  NX.syslog&&NX.syslog(`${source}_import`,`${totalMsgs} msgs from ${contactNames.join(', ')} — ${skipped} dupes skipped`);
  updateQueueStatus();
  if(localStorage.getItem('nexus_bg_process')==='on')startBackgroundProcessor();
}





// ═══ CONTACT PARSERS — vCard (.vcf) and CSV ═══

function parseVcf(text){
  const contacts=[];
  const cards=text.split('BEGIN:VCARD').slice(1);
  for(const card of cards){
    const get=(field)=>{const m=card.match(new RegExp(field+'[^:]*:(.+)','i'));return m?m[1].trim():'';};
    const fn=get('FN')||'';
    const n=get('N');
    // N format: Last;First;Middle;Prefix;Suffix
    const nParts=n.split(';');
    const name=fn||(nParts[1]?`${nParts[1]} ${nParts[0]}`.trim():nParts[0]||'');
    if(!name||name.length<2)continue;
    // Phone — can have multiple
    const phones=[];
    const phoneRe=/TEL[^:]*:(.+)/gi;
    let pm;while((pm=phoneRe.exec(card))!==null)phones.push(pm[1].trim());
    // Email — can have multiple
    const emails=[];
    const emailRe=/EMAIL[^:]*:(.+)/gi;
    let em;while((em=emailRe.exec(card))!==null)emails.push(em[1].trim());
    // Organization
    const org=get('ORG').replace(/;+$/,'');
    const title=get('TITLE');
    const note=get('NOTE');
    const addr=get('ADR').replace(/;/g,' ').replace(/\s+/g,' ').trim();
    contacts.push({
      name,org,title,
      phones,emails,
      address:addr,note,
      raw:`${name}${org?' — '+org:''}${title?' ('+title+')':''}`
    });
  }
  return contacts;
}

function parseContactsCsv(text){
  const contacts=[];
  const lines=text.split('\n').filter(l=>l.trim());
  if(lines.length<2)return contacts;
  // Parse header
  const header=lines[0].split(',').map(h=>h.trim().replace(/^"|"$/g,'').toLowerCase());
  const idx=(names)=>{for(const n of names){const i=header.indexOf(n);if(i>=0)return i;}return-1;};
  // Common column name variations
  const nameCol=idx(['name','full name','display name','first name','nombre']);
  const lastCol=idx(['last name','family name','apellido']);
  const phoneCol=idx(['phone','phone 1 - value','mobile','phone number','telefono','primary phone']);
  const phone2Col=idx(['phone 2 - value','work phone','other phone']);
  const emailCol=idx(['email','e-mail','email 1 - value','e-mail address','correo']);
  const email2Col=idx(['email 2 - value','e-mail 2']);
  const orgCol=idx(['organization','company','organization 1 - name','empresa']);
  const titleCol=idx(['title','job title','organization 1 - title','cargo']);
  const noteCol=idx(['notes','note']);
  const addrCol=idx(['address','address 1 - formatted','address 1 - street']);
  if(nameCol<0&&lastCol<0)return contacts;

  for(let i=1;i<lines.length;i++){
    // Simple CSV parse (handles quoted commas)
    const vals=[];let current='',inQuote=false;
    for(const ch of lines[i]){
      if(ch==='"'){inQuote=!inQuote;}
      else if(ch===','&&!inQuote){vals.push(current.trim());current='';}
      else current+=ch;
    }
    vals.push(current.trim());
    const g=(col)=>col>=0&&col<vals.length?vals[col].replace(/^"|"$/g,'').trim():'';

    let name=g(nameCol);
    if(lastCol>=0&&g(lastCol)){name=name?(name+' '+g(lastCol)):g(lastCol);}
    if(!name||name.length<2)continue;

    const phones=[g(phoneCol),g(phone2Col)].filter(Boolean);
    const emails=[g(emailCol),g(email2Col)].filter(Boolean);
    contacts.push({
      name,org:g(orgCol),title:g(titleCol),
      phones,emails,
      address:g(addrCol),note:g(noteCol),
      raw:`${name}${g(orgCol)?' — '+g(orgCol):''}${g(titleCol)?' ('+g(titleCol)+')':''}`
    });
  }
  return contacts;
}

function showContactImportPicker(contacts){
  clearLog();
  log(`👤 ${contacts.length} contacts found`);

  // Check which already exist as nodes
  const existingNames=new Set((NX.nodes||[]).map(n=>n.name.toLowerCase()));
  contacts.forEach(c=>{c._exists=existingNames.has(c.name.toLowerCase());});
  const newContacts=contacts.filter(c=>!c._exists);
  const existCount=contacts.length-newContacts.length;
  if(existCount)log(`⏭ ${existCount} already in Brain`);

  const overlay=document.createElement('div');overlay.className='board-modal-overlay';
  overlay.innerHTML=`<div class="board-modal" style="max-height:85vh;overflow-y:auto;max-width:440px">
    <div class="board-modal-title">👤 Import Contacts (${newContacts.length} new${existCount?' · '+existCount+' existing':''})</div>
    <div style="display:flex;gap:6px;margin-bottom:8px">
      <select class="ig-select" id="ctCatSelect" style="flex:1">
        <option value="auto">Auto-categorize</option>
        <option value="people">All → People</option>
        <option value="contractors">All → Contractors</option>
        <option value="vendors">All → Vendors</option>
      </select>
    </div>
    <div class="cp-actions" style="display:flex;gap:6px;margin-bottom:10px">
      <button class="ig-chip active" id="ctAll">Select All</button>
      <button class="ig-chip" id="ctNone">Select None</button>
    </div>
    <div id="ctList" style="display:flex;flex-direction:column;gap:4px;max-height:50vh;overflow-y:auto"></div>
    <div class="board-modal-actions" style="margin-top:12px">
      <button class="board-modal-cancel" id="ctCancel">Cancel</button>
      <button class="board-modal-save" id="ctImport">Import Selected</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  const listEl=overlay.querySelector('#ctList');
  newContacts.forEach((c,i)=>{
    const detail=[...c.phones,...c.emails].slice(0,2).join(' · ')||c.org||'';
    const row=document.createElement('label');row.className='cp-row';
    row.innerHTML=`<input type="checkbox" checked data-idx="${i}">
      <div class="cp-info">
        <div class="cp-name">${c.name}${c.org?` <span class="cp-count">${c.org}</span>`:''}</div>
        <div class="cp-preview">${detail}</div>
      </div>`;
    listEl.appendChild(row);
  });

  overlay.querySelector('#ctAll').addEventListener('click',()=>{overlay.querySelectorAll('#ctList input').forEach(cb=>cb.checked=true);});
  overlay.querySelector('#ctNone').addEventListener('click',()=>{overlay.querySelectorAll('#ctList input').forEach(cb=>cb.checked=false);});
  overlay.querySelector('#ctCancel').addEventListener('click',()=>overlay.remove());
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});

  overlay.querySelector('#ctImport').addEventListener('click',async()=>{
    const selected=[];
    overlay.querySelectorAll('#ctList input:checked').forEach(cb=>{
      const idx=parseInt(cb.dataset.idx);
      if(newContacts[idx])selected.push(newContacts[idx]);
    });
    const catMode=overlay.querySelector('#ctCatSelect')?.value||'auto';
    overlay.remove();
    if(!selected.length){log('No contacts selected.','warn');return;}
    await importSelectedContacts(selected,catMode);
  });
}

async function importSelectedContacts(contacts,catMode){
  log(`Importing ${contacts.length} contacts...`);
  let created=0,errors=0;

  for(const c of contacts){
    // Determine category
    let category='people';
    if(catMode!=='auto'){
      category=catMode;
    }else{
      // Auto-categorize by keywords
      const text=`${c.name} ${c.org} ${c.title} ${c.note}`.toLowerCase();
      if(/plumb|hvac|electric|repair|maint|clean|service|pest|fire|install/i.test(text))category='contractors';
      else if(/supply|food|bev|wine|produce|meat|dairy|linen|chem|paper|wholesale|distribut/i.test(text))category='vendors';
      else if(/chef|cook|server|bartend|manager|host|dish|busser|prep|sous|somm/i.test(text))category='people';
      else if(c.org&&!c.title)category='vendors';
    }

    // Build notes
    const notes=[];
    if(c.org)notes.push(`Company: ${c.org}`);
    if(c.title)notes.push(`Title: ${c.title}`);
    if(c.phones.length)notes.push(`Phone: ${c.phones.join(', ')}`);
    if(c.emails.length)notes.push(`Email: ${c.emails.join(', ')}`);
    if(c.address)notes.push(`Address: ${c.address}`);
    if(c.note)notes.push(`Note: ${c.note}`);

    const tags=['imported','contact'];
    if(c.org)tags.push(c.org.toLowerCase().slice(0,30));

    try{
      const{error}=await NX.sb.from('nodes').insert({
        name:c.name.slice(0,200),
        category,
        tags:tags.slice(0,10),
        notes:notes.join('\n').slice(0,3000),
        links:[],access_count:1,source_emails:[]
      });
      if(!error)created++;
      else errors++;
    }catch(e){errors++;}
  }

  log(`✅ ${created} contacts imported as nodes${errors?' ('+errors+' failed)':''}`,'success');
  if(NX.syslog)NX.syslog('contact_import',`${created} contacts imported`);
  if(NX.toast)NX.toast(`${created} contacts added to Brain`,'success');
  NX.syslog&&NX.syslog('contacts_imported',`${created} contacts`);
  await NX.loadNodes();if(NX.brain)NX.brain.init();
}

// ═══ RE-INGEST — reprocess archived emails with improved AI ═══
async function reIngestArchived(){
  const btn=document.getElementById('reIngestBtn');
  btn.disabled=true;btn.textContent='Resetting...';clearLog();
  try{
    // Reset all emails to unprocessed
    const{error}=await NX.sb.from('raw_emails').update({processed:false}).eq('processed',true);
    if(error){log('Error: '+error.message,'error');}
    else{
      const{count}=await NX.sb.from('raw_emails').select('*',{count:'exact',head:true}).eq('processed',false);
      log(`♻ <b>${count} emails</b> reset to unprocessed. Background AI will re-process them (3 every 5 min).`,'success');
      log(`Estimated time: ~${Math.ceil((count||0)/3)*5} minutes`);
      updateQueueStatus();
      if(localStorage.getItem('nexus_bg_process')==='on')startBackgroundProcessor();
    }
  }catch(e){log('Error: '+e.message,'error');}
  btn.disabled=false;btn.textContent='♻ Re-ingest Archive';
}

// ═══ AI PROCESSING WITH SOURCES + LAYER 3 (existing nodes in prompt) ═══
async function aiProcessWithSources(text,sourceMap){
  const existing=getExistingNodeList();
  try{const a=await NX.askClaude(
    `You are an entity extractor for Suerte, Este, and Bar Toti restaurants in Austin, TX.

TASK: Extract EVERY distinct entity from the emails below into structured nodes.

RULES:
1. USE FULL PROPER NAMES — "Tyler Maffi" not "Tyler". "Hoshizaki KM-901MAJ" not "ice machine".
2. ONE NODE PER ENTITY — don't create separate nodes for the same thing. If an email mentions "Hoshizaki" and another mentions "Hoshizaki KM-901MAJ", that's ONE node with the full name.
3. CHECK THE EXISTING NODES LIST — if a node already exists with the same or similar name, DO NOT create it again. Output it as a match using "merge_with" field.
4. INCLUDE EVERY DETAIL in notes — phone numbers, emails, amounts, dates, part numbers, serial numbers, model numbers, order numbers, tracking numbers. Never summarize, always preserve raw data.
5. NOTES MUST BE FACTUAL — only state things directly from the source text. Never infer or assume.

CATEGORIES (use exactly one):
equipment | contractors | vendors | procedure | projects | people | systems | parts | location

CARDS — BE VERY STRICT. The board is for restaurant operations only.

ONLY create a card if the email contains a CONCRETE action item for RESTAURANT OPERATIONS:
  ✓ Equipment repair, maintenance, service scheduling
  ✓ Contractor coordination (PM visits, emergency calls, follow-up)
  ✓ Vendor orders, quotes to review, invoices to approve
  ✓ Health inspection items, food safety issues
  ✓ Staff scheduling changes, shift swaps, payroll items
  ✓ Supply deliveries, inventory actions
  ✓ Cleaning issues requiring action
  ✓ Permits, licenses, compliance deadlines

NEVER create a card for:
  ✗ Personal correspondence (family, friends, childcare, social plans)
  ✗ Financial notifications unrelated to the restaurants (bank alerts, credit card alerts, Cash App)
  ✗ Newsletters, marketing emails, promotional offers, unsubscribe links
  ✗ Software service updates, subscription renewals unrelated to restaurant ops
  ✗ General "we should..." or "someone should..." statements without a concrete action, actor, or deadline
  ✗ Information-only emails that don't require a response
  ✗ Anything you're not CERTAIN is a restaurant operations action item

For EVERY card you output, you MUST include:
- "ops_confidence" (0.0–1.0) — your confidence this is a real restaurant ops task
- "evidence" — a direct quote (15+ words) from the email that proves the action item exists

If ops_confidence < 0.75, DO NOT INCLUDE THE CARD. If you cannot quote a specific line proving the action, DO NOT INCLUDE THE CARD.

When in doubt, omit. An empty cards array is the correct answer for most emails.

RESPOND ONLY WITH RAW JSON — no markdown, no backticks, no explanation:
{
  "nodes": [
    {
      "name": "Full Proper Name (include model numbers for equipment)",
      "category": "one of the categories above",
      "tags": ["relevant", "searchable", "terms"],
      "notes": "ALL details: specs, prices, phone, email, model numbers, part numbers, serial numbers, order info, dates, amounts. Preserve exact numbers.",
      "email_refs": [1],
      "merge_with": "Existing Node Name if this is the same entity, otherwise omit"
    }
  ],
  "cards": [
    {
      "title": "Specific action (verb + object + context, e.g. 'Schedule Hoshizaki PM for week of March 10')",
      "column_name": "todo",
      "ops_confidence": 0.85,
      "evidence": "direct quote from email proving this action item exists, 15+ words"
    }
  ],
  "contractor_events": [
    {"contractor_name": "Full name", "event_date": "YYYY-MM-DD", "event_time": "HH:MM AM/PM or null", "location": "suerte|este|toti or null", "description": "what they are doing"}
  ]
}

EXISTING NODES (do NOT duplicate these):${existing}`,
    [{role:'user',content:text.slice(0,14000)}],4096);
  let j=a.replace(/```json\s*/gi,'').replace(/```\s*/g,'');const s=j.indexOf('{'),e=j.lastIndexOf('}');if(s===-1||e<=s){log('No JSON','warn');return null;}j=j.slice(s,e+1);
  try{const p=JSON.parse(j);if(!p.nodes||!Array.isArray(p.nodes))return null;
    p.nodes.forEach(n=>{
      if(n.email_refs&&Array.isArray(n.email_refs)&&sourceMap){
        const matchedSources=n.email_refs.map(ref=>sourceMap.find(s=>s.ref===ref)).filter(Boolean);
        n.source_emails=matchedSources.map(src=>({from:src.from,subject:src.subject,date:src.date,body:src.body||'',snippet:src.body?.slice(0,200)||''}));
        // Collect all attachments from matched emails
        n.attachments=[];
        matchedSources.forEach(src=>{
          if(src.attachments&&src.attachments.length){
            src.attachments.forEach(a=>{
              if(a.url)n.attachments.push({url:a.url,filename:a.filename||'file',type:a.type||a.mimeType||'',from:src.from,date:src.date});
            });
          }
        });
      }else{n.source_emails=[];n.attachments=[];}
    });
    return p;}catch(pe){log('JSON parse: '+pe.message,'error');return null;}}catch(e){log('AI: '+e.message,'error');return null;}}

// Plain AI process (for paste/trello) — LAYER 3 included
async function aiProcess(text){
  const existing=getExistingNodeList(); // LAYER 3
  try{const a=await NX.askClaude(`Extract knowledge for restaurant ops (Suerte, Este, Bar Toti — Austin TX). Create nodes for every distinct entity.
DO NOT create nodes that already exist — check the list below.
Categories: equipment, contractors, vendors, procedure, projects, people, systems, parts, location

CARDS — STRICT. Only create a card for CONCRETE restaurant operations actions:
  ✓ Equipment repair/maintenance, contractor scheduling, vendor orders, health inspections, staff changes, supply deliveries, permits/compliance.
  ✗ NEVER create cards for personal items, newsletters, financial alerts unrelated to the restaurants, generic "we should..." statements, or anything not certain.
Every card MUST have ops_confidence >= 0.75 AND evidence (a direct 15+ word quote). If you can't prove the action with a quote, OMIT THE CARD.

RESPOND ONLY RAW JSON:
{"nodes":[{"name":"...","category":"...","tags":["..."],"notes":"..."}],"cards":[{"title":"Specific action","column_name":"todo","ops_confidence":0.85,"evidence":"direct quote from source 15+ words"}]}${existing}`,[{role:'user',content:text.slice(0,14000)}],4096);
  let j=a.replace(/```json\s*/gi,'').replace(/```\s*/g,'');const s=j.indexOf('{'),e=j.lastIndexOf('}');if(s===-1||e<=s)return null;j=j.slice(s,e+1);
  try{const p=JSON.parse(j);return(p.nodes&&Array.isArray(p.nodes))?p:null;}catch(e){log('JSON: '+e.message,'error');return null;}}catch(e){log('AI: '+e.message,'error');return null;}}

// ═══ SAVE EXTRACTED — LAYER 2 (fuzzy dedup) ═══
async function saveExtracted(r){if(!r||!r.nodes||!r.nodes.length)return 0;let c=0,updated=0,er=0;
const createdNames=[];
// Build existing node map from Supabase
let existingMap={};
try{const{data}=await NX.sb.from('nodes').select('id,name,notes,tags,source_emails,attachments');
  if(data)data.forEach(n=>{if(n.name)existingMap[n.name.toLowerCase()]={id:n.id,name:n.name,notes:n.notes||'',tags:n.tags||[],source_emails:n.source_emails||[],attachments:n.attachments||[]};});}catch(e){
  if(NX.toast)NX.toast('Failed to load existing nodes','error');return 0;
}
const vc=['equipment','contractors','vendors','procedure','projects','people','systems','parts','location'];
for(const n of r.nodes){const nm=(n.name||'').trim();if(!nm||nm.length<2)continue;
  const newNotes=(n.notes||'').slice(0,3000);
  const newTags=Array.isArray(n.tags)?n.tags.filter(t=>typeof t==='string').slice(0,20):[];
  const newSources=n.source_emails||[];
  const newAtts=n.attachments||[];

  // Check for merge_with (AI-suggested match)
  let existKey=null;
  if(n.merge_with){
    existKey=Object.keys(existingMap).find(k=>k===n.merge_with.toLowerCase());
  }
  // Fallback to fuzzy name match
  if(!existKey){
    existKey=Object.keys(existingMap).find(k=>
      k===nm.toLowerCase()||
      isFuzzyDuplicate(nm,new Set([k]))||
      // Also catch substring matches like "Tyler" matching "Tyler Maffi"
      (nm.length>3 && k.includes(nm.toLowerCase())) ||
      (k.length>3 && nm.toLowerCase().includes(k))
    );
  }

  if(existKey){
    // MERGE — update existing node with new data
    const ex=existingMap[existKey];
    // Append notes instead of replacing (keep both)
    let mergedNotes=ex.notes;
    if(newNotes&&newNotes.length>10&&!ex.notes.includes(newNotes.slice(0,50))){
      mergedNotes=(ex.notes+'\n\n'+newNotes).slice(0,4000);
    }
    const mergedTags=[...new Set([...ex.tags,...newTags])].slice(0,30);
    const mergedSources=[...ex.source_emails,...newSources].slice(0,50);
    const allAtts=[...ex.attachments,...newAtts];
    const attSeen=new Set();const mergedAtts=allAtts.filter(a=>{const k=(a.filename||'')+'|'+(a.url||'');if(attSeen.has(k))return false;attSeen.add(k);return true;}).slice(0,20);
    // Use the longer/more specific name
    const betterName=nm.length>ex.name.length?nm.slice(0,200):ex.name;
    const updates={notes:mergedNotes,tags:mergedTags,source_emails:mergedSources,attachments:mergedAtts};
    if(betterName!==ex.name)updates.name=betterName;
    try{await NX.sb.from('nodes').update(updates).eq('id',ex.id);
      updated++;
      existingMap[existKey]={...ex,...updates,name:betterName};
    }catch(e){
      er++;if(NX.toast)NX.toast(`Merge failed: ${nm}`,'error');
    }
    continue;
  }
  // New node — privacy pre-filter before insert
  const fullText=nm+' '+(newNotes||'');
  const SENSITIVE_PATTERNS=[
    /\b\d{3}-\d{2}-\d{4}\b/,          // SSN
    /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // credit card
    /\b(?:bank\s*account|routing\s*number|acct\s*#)\b/i,
    /\b(?:salary|wage|pay\s*rate|hourly\s*rate|bonus|compensation)\s*[\$:]\s*\d/i,
  ];
  let isSensitive=false;
  for(const pat of SENSITIVE_PATTERNS){
    if(pat.test(fullText)){
      log(`🔒 Blocked: "${nm}" contains sensitive data (auto-redacted)`,'warn');
      isSensitive=true;break;
    }
  }
  if(isSensitive){er++;continue;}

  const row={name:nm.slice(0,200),category:vc.includes(n.category)?n.category:'equipment',tags:newTags,notes:newNotes,links:[],access_count:1,source_emails:newSources,attachments:newAtts};
  const{error}=await NX.sb.from('nodes').insert(row);
  if(error){er++;if(er<=3)log(`Insert "${nm}": ${error.message}`,'error');if(NX.toast)NX.toast(`Failed: ${nm}`,'error');}
  else{existingMap[nm.toLowerCase()]={id:0,name:nm,notes:newNotes,tags:newTags,source_emails:newSources,attachments:newAtts};createdNames.push(nm);c++;}}
// ═══════════════════════════════════════════════════════════════════════
// CARD INSERTION GATE — Layer 2 of the card-flood defense
// Even with a tightened prompt, we don't trust the LLM blindly. Every
// card must pass:
//   1. ops_confidence >= 0.75 (the LLM's own confidence self-check)
//   2. evidence present and substantial (>= 15 chars of source quote)
// Cards that pass get an audit trail in the description so future
// review can trace back why each card was created.
// ═══════════════════════════════════════════════════════════════════════
if(r.cards) {
  let inserted = 0, rejected = 0;
  for (const x of r.cards) {
    if (!x.title) continue;
    const conf = typeof x.ops_confidence === 'number' ? x.ops_confidence : 0;
    if (conf < 0.75) { rejected++; continue; }
    const evidence = (x.evidence || '').trim();
    if (evidence.length < 15) { rejected++; continue; }
    const auditTrail = `Source quote: "${evidence}"\n\n(auto-ingested from email, confidence ${conf.toFixed(2)})`;
    try {
      await NX.sb.from('kanban_cards').insert({
        title: (x.title||'').slice(0, 200),
        description: auditTrail.slice(0, 2000),
        column_name: x.column_name || 'todo',
        status: 'open',
        archived: false,
      });
      inserted++;
    } catch (e) {
      console.warn('[ingest] card insert failed:', e?.message);
      rejected++;
    }
  }
  if (inserted > 0 || rejected > 0) {
    log(`  📋 Cards: ${inserted} created, ${rejected} rejected (low confidence or weak evidence)`, inserted > 0 ? 'success' : 'info');
  }
}
// Save contractor events
if(r.contractor_events){
  let evtCount=0;
  for(const evt of r.contractor_events){
    if(!evt.contractor_name||!evt.event_date)continue;
    try{
      await NX.sb.from('contractor_events').upsert({
        contractor_name:evt.contractor_name.slice(0,200),
        event_date:evt.event_date,
        event_time:evt.event_time||null,
        location:evt.location||null,
        description:(evt.description||'').slice(0,500),
        status:'scheduled'
      },{onConflict:'contractor_name,event_date'});
      evtCount++;
    }catch(e){}
  }
  if(evtCount)log(`📅 ${evtCount} contractor visit(s) scheduled`,'success');
}
if(updated)log(`${updated} existing nodes enriched`,'success');
if(er)log(`${er} inserts failed`,'error');
if(createdNames.length&&NX.autoLinkNewNodes&&shouldAutoLink()){await NX.loadNodes();NX.autoLinkNewNodes(createdNames);}
// Auto-triage — check for urgent items
if(r.nodes&&r.nodes.length)triageNewNodes(r.nodes);
return c+updated;}

// ═══ AUTO-TRIAGE — flag urgent items during pipeline ═══
const URGENT_PATTERNS=[
  {re:/health\s*(?:dept|department|inspector|inspection|violation)/i,label:'🏥 Health Dept'},
  {re:/equipment\s*(?:failure|down|broken|not\s*working|malfunction)/i,label:'🔧 Equipment Down'},
  {re:/\b(?:water\s*leak|flood|water\s*damage|burst\s*pipe)\b/i,label:'💧 Water/Leak'},
  {re:/\b(?:fire\s*(?:alarm|damage|hazard)|smoke\s*(?:alarm|damage))\b/i,label:'🔥 Fire/Safety'},
  {re:/\b(?:pest\s*(?:control|issue|problem|inspection|treatment|infestation)|cockroach|rodent|mice\b|mouse\s*trap|rat\s*trap)\b/i,label:'🐛 Pest Issue'},
  {re:/\b(?:price\s*increase|rate\s*(?:increase|change)|cost\s*increase)\b/i,label:'💰 Price Change'},
  {re:/\b(?:cancel|terminat|discontinue)\b/i,label:'⚠ Cancellation'},
  {re:/\b(?:expire|past\s*due|overdue\s*(?:invoice|payment|bill))\b/i,label:'⏰ Expiring/Overdue'},
  {re:/\b(?:urgent|emergency|asap|immediately|critical)\b/i,label:'🚨 Urgent'},
  {re:/\b(?:recall|safety\s*alert|warning\s*notice)\b/i,label:'⚠ Safety Alert'},
];

function triageNewNodes(nodes){
  const alerts=[];
  for(const n of nodes){
    const text=`${n.name||''} ${n.notes||''}`;
    for(const p of URGENT_PATTERNS){
      if(p.re.test(text)){
        alerts.push({label:p.label,node:n.name,snippet:(n.notes||'').slice(0,80)});
        break; // One alert per node
      }
    }
  }
  if(!alerts.length)return;
  // Show urgent toast
  alerts.forEach(a=>{
    if(NX.toast)NX.toast(`${a.label}: ${a.node}`,'error',8000);
  });
  log(`🚨 <b>${alerts.length} URGENT</b> items detected:`,'error');
  alerts.forEach(a=>log(`  ${a.label} — ${a.node}: ${a.snippet}`,'error'));
  // Store for proactive chat
  NX._urgentAlerts=(NX._urgentAlerts||[]).concat(alerts).slice(-20);
}

// ═══ MAIL MONITOR (enhanced: scrapes attachments + links to nodes) ═══

// ═══ TRELLO (BATCHED + LAYER 1 dedup) ═══

// ═══ PASTE ═══
async function ingestText(){const t=document.getElementById('ingestText').value.trim();if(!t)return;const b=document.getElementById('ingestTextBtn');b.disabled=true;b.textContent='...';clearLog();log('Processing ('+t.length+' chars)...');const r=await aiProcess(t);if(r){const s=await saveExtracted(r);log(`<b>${s} nodes</b>`,'success');await NX.loadNodes();if(NX.brain)NX.brain.init();updateStats();}else log('No data.','warn');b.disabled=false;b.textContent='Process';document.getElementById('ingestText').value='';}

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function updateStats(){const el=document.getElementById('ingestStats');if(!el)return;const t=NX.nodes.length,c={};NX.nodes.forEach(n=>{c[n.category]=(c[n.category]||0)+1;});el.innerHTML=`<div class="stat-total">${t} nodes in brain · ${processedIds.size} items processed</div><div class="stat-chips">${Object.entries(c).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<span class="stat-chip">${k} <b>${v}</b></span>`).join('')}</div>`;}

// ═══ WEEKLY DIGEST — generates operational report via Claude ═══
async function generateDigest(){
  clearLog();log('📊 Generating weekly digest...');
  // (api key check removed — edge function holds the key)
  try{
    const weekAgo=new Date(Date.now()-7*86400000).toISOString();
    const today=new Date().toISOString().split('T')[0];

    // Gather week's data
    const [hoursR,ticketsR,nodesR,cardsR,cleanR,chatsR]=await Promise.allSettled([
      NX.sb.from('time_clock').select('user_name,hours,clock_in,location').gte('clock_in',weekAgo).not('hours','is',null),
      NX.sb.from('tickets').select('title,location,status,created_at').gte('created_at',weekAgo),
      NX.sb.from('nodes').select('name,category,created_at').gte('created_at',weekAgo),
      NX.sb.from('kanban_cards').select('title,column_name,due_date,location').limit(50),
      NX.sb.from('daily_logs').select('entry,created_at').gte('created_at',weekAgo).like('entry','%Cleaning%'),
      NX.sb.rpc('get_chat_history_admin', { p_since: weekAgo, p_limit: 50 })
    ]);

    const hours=hoursR.status==='fulfilled'?hoursR.value.data||[]:[];
    const tickets=ticketsR.status==='fulfilled'?ticketsR.value.data||[]:[];
    const newNodes=nodesR.status==='fulfilled'?nodesR.value.data||[]:[];
    const cards=cardsR.status==='fulfilled'?cardsR.value.data||[]:[];
    const cleaning=cleanR.status==='fulfilled'?cleanR.value.data||[]:[];
    const chats=chatsR.status==='fulfilled'?chatsR.value.data||[]:[];

    // Summarize hours by person
    const byPerson={};
    hours.forEach(h=>{byPerson[h.user_name]=(byPerson[h.user_name]||0)+parseFloat(h.hours||0);});
    const hoursStr=Object.entries(byPerson).sort((a,b)=>b[1]-a[1]).map(([n,h])=>`${n}: ${h.toFixed(1)}h`).join(', ');

    // Ticket summary
    const openTickets=tickets.filter(t=>t.status==='open');
    const closedTickets=tickets.filter(t=>t.status==='closed');

    // Card summary
    const todo=cards.filter(c=>c.column_name==='todo');
    const done=cards.filter(c=>c.column_name==='done');
    const overdue=cards.filter(c=>c.due_date&&c.due_date<today&&c.column_name!=='done');

    // Build data for Claude
    const data=`WEEK OF ${new Date(Date.now()-7*86400000).toLocaleDateString()} — ${new Date().toLocaleDateString()}

HOURS WORKED:
${hoursStr||'No hours logged'}
Total staff hours: ${Object.values(byPerson).reduce((a,b)=>a+b,0).toFixed(1)}

TICKETS:
${openTickets.length} still open: ${openTickets.map(t=>t.title).join(', ')||'none'}
${closedTickets.length} closed this week

BOARD:
${todo.length} tasks in To Do, ${done.length} completed, ${overdue.length} overdue
${overdue.length?'Overdue: '+overdue.map(c=>c.title).join(', '):''}

NEW KNOWLEDGE:
${newNodes.length} new nodes added to brain this week
Categories: ${[...new Set(newNodes.map(n=>n.category))].join(', ')||'none'}

CLEANING:
${cleaning.length} cleaning reports logged
${cleaning.slice(-3).map(l=>(l.entry||'').slice(0,80)).join('\n')||'No reports'}

KEY CONVERSATIONS (${chats.length} total):
${chats.slice(0,8).map(c=>`${c.user_name}: "${(c.question||'').slice(0,60)}"`).join('\n')||'None'}`;

    log('Sending to Claude for analysis...');
    let digest = '';
    try {
      digest = await NX.askClaude(
        '',
        [{ role: 'user', content: `You are NEXUS, a personal intelligence system for Suerte, Este, and Bar Toti restaurants (Austin TX). Generate a weekly operations digest from this data. Be direct, insightful, and actionable. Flag concerns. Praise wins. Suggest what to focus on next week. Format with headers but keep it concise — this goes on a phone screen.\n\n${data}` }],
        800
      );
    } catch (e) {
      log('Digest generation failed: ' + (e?.message || e), 'error');
      return;
    }
    if(!digest){log('No digest generated','error');return;}

    // Display in log
    log('═══ WEEKLY DIGEST ═══','success');
    digest.split('\n').forEach(line=>{
      if(line.trim())log(line.replace(/\*\*(.*?)\*\*/g,'<b>$1</b>'));
    });

    // Save to daily_logs
    try{
      await NX.sb.from('daily_logs').insert({
        entry:`📊 WEEKLY DIGEST (${today}):\n${digest}`,
        user_id:NX.currentUser?.id||0,
        user_name:'NEXUS'
      });
      log('Digest saved to logs ✓','success');
    }catch(e){}

  }catch(e){log('Digest error: '+e.message,'error');}
}

// ═══ SMART REMINDERS — find unresolved discussions ═══
async function smartReminders(){
  clearLog();log('🧠 Scanning for unresolved items...');
  // (api key check removed — edge function holds the key)
  try{
    const twoWeeks=new Date(Date.now()-14*86400000).toISOString();

    // Get recent chats
    const{data:chats}=await NX.sb.rpc('get_chat_history_admin', { p_since: twoWeeks, p_limit: 100 });

    // Get existing cards and tickets
    const{data:cards}=await NX.sb.from('kanban_cards').select('title').limit(200);
    const{data:tickets}=await NX.sb.from('tickets').select('title').limit(200);

    if(!chats||chats.length<3){log('Not enough conversations to analyze','warn');return;}

    const chatStr=chats.map(c=>`[${new Date(c.created_at).toLocaleDateString()} ${c.user_name}] Q: ${(c.question||'').slice(0,100)}\nA: ${(c.answer||'').slice(0,150)}`).join('\n---\n');
    const existingItems=[...(cards||[]).map(c=>c.title),...(tickets||[]).map(t=>t.title)].join(', ');

    let text = '';
    try {
      text = await NX.askClaude(
        '',
        [{ role: 'user', content: `You are NEXUS. Review these recent conversations and find items that were DISCUSSED but never turned into action items. Things like "we should replace that" or "let's order the part" or "I'll call them Monday" — promises and intentions that might have been forgotten.

EXISTING CARDS/TICKETS (already tracked):
${existingItems||'none'}

RECENT CONVERSATIONS:
${chatStr}

List 1-5 items that seem unresolved. For each, give:
- What was discussed
- Who discussed it and when
- Suggested action (create card, create ticket, or follow up)

If everything looks handled, say so. Be brief. JSON format:
{"items":[{"discussed":"...","who":"...","date":"...","action":"..."}],"all_clear":false}` }],
        500
      );
    } catch (e) {
      log('Smart reminders failed: ' + (e?.message || e), 'error');
      return;
    }

    try{
      const clean=text.replace(/```json|```/g,'').trim();
      const parsed=JSON.parse(clean);
      if(parsed.all_clear||!parsed.items||!parsed.items.length){
        log('✅ All clear — no unresolved items found','success');
        return;
      }
      log(`Found ${parsed.items.length} unresolved items:`,'warn');
      for(const item of parsed.items){
        log(`<div class="reminder-item">
          <div class="reminder-what">${item.discussed}</div>
          <div class="reminder-who">${item.who} — ${item.date}</div>
          <div class="reminder-action">
            <button class="reminder-btn" onclick="NX.sb.from('kanban_cards').insert({title:'${(item.discussed||'').slice(0,80).replace(/'/g,"\\'")}',column_name:'todo'}).then(()=>{NX.toast('Card added ✓','success');this.textContent='Added ✓';this.disabled=true;})">+ Add Card</button>
            Suggested: ${item.action}
          </div>
        </div>`);
      }
    }catch(e){
      // Not JSON — show raw
      log(text);
    }
  }catch(e){log('Reminder error: '+e.message,'error');}
}
// ═══ SENSITIVE DATA SCANNER — AI identifies and removes personal nodes ═══
// ═══ NODE DEDUPLICATION TOOL ═══
async function findDuplicates(){
  clearLog();log('🔍 Scanning for duplicate nodes...');
  try{
    const{data}=await NX.sb.from('nodes').select('id,name,category,notes,tags');
    if(!data||data.length<2){log('Not enough nodes to check.','warn');return;}
    // Build name list for Claude
    const nodeList=data.map(n=>`#${n.id}: ${n.name} (${n.category})`).join('\n');
    log(`Analyzing ${data.length} nodes...`);
    const result=await NX.askClaude(
      `You are analyzing a knowledge base for duplicate entries. These nodes may refer to the same entity with different names.

FIND DUPLICATES — same entity, different names. Examples:
- "Tyler" and "Tyler Maffi" → same person
- "Hoshizaki" and "Hoshizaki KM-901MAJ" → same equipment
- "ice machine suerte" and "Hoshizaki KM-901MAJ" → same equipment
- "Parts Town" and "partstown.com" → same vendor

DO NOT flag as duplicates:
- Different models of same brand (Hoshizaki KM-901 vs Hoshizaki AM-50BAJ are different machines)
- Same category but different entities (two different contractors)

Return ONLY raw JSON:
{"duplicates":[{"keep_id":123,"keep_name":"Tyler Maffi","merge_ids":[456],"merge_names":["Tyler"],"reason":"Same person, keep full name"}]}

If no duplicates found, return: {"duplicates":[]}`,
      [{role:'user',content:nodeList.slice(0,14000)}],2000);

    let j=result.replace(/```json\s*/gi,'').replace(/```\s*/g,'');
    const s=j.indexOf('{'),e=j.lastIndexOf('}');
    if(s===-1||e<=s){log('No results from AI.','warn');return;}
    const parsed=JSON.parse(j.slice(s,e+1));
    if(!parsed.duplicates||!parsed.duplicates.length){
      log('✓ No duplicates found!','success');return;
    }
    log(`Found ${parsed.duplicates.length} duplicate groups:`);
    // Show review UI
    const reviewDiv=document.createElement('div');reviewDiv.className='dedup-review';
    parsed.duplicates.forEach((d,i)=>{
      const item=document.createElement('div');item.className='dedup-item';
      item.innerHTML=`
        <div class="dedup-header">
          <span class="dedup-keep">Keep: <b>${d.keep_name}</b> (#${d.keep_id})</span>
          <span class="dedup-merge">Merge: ${d.merge_names.join(', ')}</span>
        </div>
        <div class="dedup-reason">${d.reason}</div>
        <button class="dedup-btn" data-idx="${i}">Merge ✓</button>
        <button class="dedup-skip" data-idx="${i}">Skip</button>
      `;
      // Merge handler
      item.querySelector('.dedup-btn').addEventListener('click',async function(){
        this.disabled=true;this.textContent='Merging...';
        const keepNode=data.find(n=>n.id===d.keep_id);
        if(!keepNode){this.textContent='Node not found';return;}
        for(const mid of d.merge_ids){
          const mergeNode=data.find(n=>n.id===mid);
          if(!mergeNode)continue;
          // Combine notes
          const combinedNotes=((keepNode.notes||'')+'\n\n'+(mergeNode.notes||'')).slice(0,4000);
          const combinedTags=[...new Set([...(keepNode.tags||[]),...(mergeNode.tags||[])])].slice(0,30);
          await NX.sb.from('nodes').update({notes:combinedNotes,tags:combinedTags}).eq('id',d.keep_id);
          await NX.sb.from('nodes').delete().eq('id',mid);
          log(`  Merged "${mergeNode.name}" → "${keepNode.name}"`,'success');
        }
        this.textContent='✓ Merged';
        item.style.opacity='0.4';
      });
      item.querySelector('.dedup-skip').addEventListener('click',function(){
        item.style.opacity='0.3';this.textContent='Skipped';
      });
      reviewDiv.appendChild(item);
    });
    document.getElementById('ingestLog')?.appendChild(reviewDiv);
  }catch(e){log('Dedup error: '+e.message,'error');}
}

async function scanSensitive(){
  const btn=document.getElementById('sensitiveBtn');if(!btn)return;
  btn.disabled=true;btn.textContent='Scanning...';clearLog();
  log('🔒 Scanning nodes for sensitive/personal data...');

  // Load learned rules from Supabase (persists across devices)
  let safePatterns=[];
  let deletePatterns=[];
  let customRules=[];
  try{
    const{data}=await NX.sb.rpc('get_admin_privacy_rules');
    safePatterns=data?.privacy_safe||[];
    deletePatterns=data?.privacy_deleted||[];
    customRules=data?.privacy_custom_rules||[];
  }catch(e){
    // Fallback to localStorage
    safePatterns=JSON.parse(localStorage.getItem('nexus_safe_patterns')||'[]');
  }

  const allNodes=NX.nodes.filter(n=>!n.is_private);
  if(!allNodes.length){log('No nodes to scan.','warn');btn.disabled=false;btn.textContent='Scan & Remove Personal Data';return;}

  let flagged=[];
  const BATCH=50;
  for(let i=0;i<allNodes.length;i+=BATCH){
    const batch=allNodes.slice(i,i+BATCH);
    log(`Scanning batch ${Math.floor(i/BATCH)+1}/${Math.ceil(allNodes.length/BATCH)}...`);
    const nodeList=batch.map(n=>`[ID:${n.id}] ${n.name} (${n.category}): ${(n.notes||'').slice(0,200)}`).join('\n');

    const safeNote=safePatterns.length?`\n\nPREVIOUSLY APPROVED AS SAFE (do NOT flag these):\n${safePatterns.slice(-30).join('\n')}`:'';
    const deletedNote=deletePatterns.length?`\n\nPREVIOUSLY DELETED AS SENSITIVE (flag similar patterns):\n${deletePatterns.slice(-20).join('\n')}`:'';
    const customNote=customRules.length?`\n\nCUSTOM RULES FROM USER:\n${customRules.join('\n')}`:'';

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
- Staff names with restaurant roles only
- Delivery confirmations, order numbers, invoices${safeNote}${deletedNote}${customNote}

Severity levels:
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

  // Save learned rules back to Supabase
  async function savePrivacyRules(){
    try{
      // RPC does a proper jsonb merge — won't wipe gmail_refresh_token,
      // VAPID key, or any other field stored alongside in config.
      await NX.sb.rpc('save_admin_privacy_rules', {
        p_safe:         safePatterns.slice(-50),
        p_deleted:      deletePatterns.slice(-30),
        p_custom_rules: customRules,
      });
    }catch(e){
      // Fallback save to localStorage
      localStorage.setItem('nexus_safe_patterns',JSON.stringify(safePatterns));
    }
  }

  const reviewDiv=document.createElement('div');reviewDiv.className='sensitive-review';
  let reviewed=0;

  for(const f of flagged){
    const node=NX.nodes.find(n=>String(n.id)===String(f.id));
    const card=document.createElement('div');card.className='sensitive-card';
    const sevColor=f.severity==='high'?'var(--red)':f.severity==='medium'?'var(--amber)':'var(--blue)';
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

    // DELETE — learns from this deletion
    const delBtn=document.createElement('button');delBtn.className='sensitive-btn sensitive-btn-del';
    delBtn.textContent='Delete';
    delBtn.addEventListener('click',async()=>{
      try{await NX.sb.from('nodes').delete().eq('id',f.id);
        NX.nodes=NX.nodes.filter(x=>String(x.id)!==String(f.id));
        card.style.opacity='0.3';card.style.pointerEvents='none';
        delBtn.textContent='Deleted';reviewed++;
        // Learn from deletion
        deletePatterns.push(`${f.reason} (${f.severity}) — deleted ${f.name}`);
        savePrivacyRules();
        log(`Deleted: ${f.name}`,'success');
        if(NX.syslog)NX.syslog('privacy_delete',f.name+' — '+f.reason);
        checkDone();
      }catch(e){delBtn.textContent='Error';}
    });

    // KEEP — learns this is safe
    const keepBtn=document.createElement('button');keepBtn.className='sensitive-btn sensitive-btn-keep';
    keepBtn.textContent='Keep';
    keepBtn.addEventListener('click',()=>{
      safePatterns.push(`${f.name} — ${f.reason} (user approved)`);
      savePrivacyRules();
      card.style.opacity='0.3';card.style.pointerEvents='none';
      keepBtn.textContent='Marked safe';reviewed++;
      log(`Kept: ${f.name} (won't flag again)`,'success');
      if(NX.syslog)NX.syslog('privacy_keep',f.name);
      checkDone();
    });

    // MAKE PRIVATE
    const privBtn=document.createElement('button');privBtn.className='sensitive-btn sensitive-btn-priv';
    privBtn.textContent='Private';
    privBtn.addEventListener('click',async()=>{
      try{await NX.sb.from('nodes').update({is_private:true}).eq('id',f.id);
        if(node)node.is_private=true;
        card.style.opacity='0.3';card.style.pointerEvents='none';
        privBtn.textContent='Made private';reviewed++;
        log(`Private: ${f.name} (admin only)`,'success');
        if(NX.syslog)NX.syslog('privacy_private',f.name);
        checkDone();
      }catch(e){privBtn.textContent='Error';}
    });

    // EDIT
    const editBtn=document.createElement('button');editBtn.className='sensitive-btn sensitive-btn-edit';
    editBtn.textContent='Edit';
    editBtn.addEventListener('click',()=>{
      const current=node?node.notes||'':'';
      const newNotes=prompt('Edit notes (remove sensitive info):',current);
      if(newNotes!==null&&node){
        NX.sb.from('nodes').update({notes:newNotes}).eq('id',node.id);
        node.notes=newNotes;
        card.style.opacity='0.3';card.style.pointerEvents='none';
        editBtn.textContent='Updated';reviewed++;
        log(`Edited: ${f.name}`,'success');
        if(NX.syslog)NX.syslog('privacy_edit',f.name);
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
  if(NX.syslog)NX.syslog('link_built',`${totalLinks} relationships created`);
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

NX.modules.ingest={init,show:()=>{
  try{
    restoreChipStates();
    const alt=document.getElementById('autoLinkToggle');if(alt)alt.checked=localStorage.getItem('nexus_auto_link')!=='off';
    const bgt=document.getElementById('bgProcessToggle');if(bgt)bgt.checked=localStorage.getItem('nexus_bg_process')==='on';
    updateProcStatus();
    updateQueueStatus();
    updateServerHeartbeat();
    updateTodayStats();
  }catch(e){console.error('Ingest show error:',e);}
}};
})();
