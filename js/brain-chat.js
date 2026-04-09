/* NEXUS Brain Chat v9 — AI, voice, commands, research, timestamps */
(function(){
  if(!localStorage.getItem('nexus_session_id'))localStorage.setItem('nexus_session_id',crypto.randomUUID?crypto.randomUUID():'s_'+Date.now()+'_'+Math.random().toString(36).slice(2));
  const SESSION_ID=localStorage.getItem('nexus_session_id');
  let chatHistory=[],voiceOn=false,recognition=null,chatActive=false;
  function tt(k){return NX.i18n?NX.i18n.t(k):k;}

  const PERSONA_BASE=`You are NEXUS, the AI ops brain for Alfredo Ortiz — Suerte, Este, Bar Toti (Austin TX).

YOUR CAPABILITIES:
- Email source references for nodes — cite when asked "why" or "where from"
- Past conversation memory across sessions
- Users type "research [topic]" to search the web and auto-create nodes
- "log that [something]" creates a daily log entry
- "add card: [task]" creates a kanban card
- "clean sensitive" scans for personal data
- "report [issue]" or "problem [description]" creates a maintenance ticket with AI troubleshooting, photo upload, and notifications
- Mail Monitor in Ingest scans Gmail for invoices and attachments

PERSONALITY: Sharp, concise, warm. Dry wit. Helpful FIRST. Be CONCISE — 2-3 sentences max unless asked.
When you don't know something, tell the user to TYPE "research [topic]" in the chat. You CANNOT trigger research yourself.`;

  function getPERSONA(){
    const lang=NX.i18n?NX.i18n.getLang():'en';
    if(lang==='es')return PERSONA_BASE+'\n\nIMPORTANT: Respond ONLY in Spanish. All answers must be in Spanish regardless of input language.';
    return PERSONA_BASE+'\n\nRespond in English by default. If user writes in Spanish, respond in Spanish.';
  }

  function checkApiKey(){const b=document.getElementById('apiBanner');if(b)b.style.display=NX.getApiKey()?'none':'flex';}
  function timeStr(){const d=new Date();return d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}).toLowerCase();}

  function buildDynamicChips(){
    const el=document.getElementById('brainExamples');if(!el)return;el.innerHTML='';
    const top=NX.nodes.filter(n=>!n.is_private).sort((a,b)=>(b.access_count||0)-(a.access_count||0)).slice(0,6);
    const prompts=top.map(n=>{if(n.category==='contractors')return`Who is ${n.name}?`;if(n.category==='equipment')return`${n.name} status?`;if(n.category==='procedure')return`${n.name}?`;return`Tell me about ${n.name}`;});
    if(prompts.length<3)prompts.push('What do you know?','Show me all contractors','Protocolo de limpieza?');
    prompts.slice(0,6).forEach(p=>{const b=document.createElement('button');b.className='brain-ex';b.textContent=p;b.addEventListener('click',()=>{document.getElementById('chatInput').value=p;document.getElementById('chatSend').disabled=false;askAI();});el.appendChild(b);});
  }

  // Commands
  const TASK_RX=[
    {rx:/^(?:log|note|record)\s+(?:that\s+)?(.+)/i,type:'log'},
    {rx:/^(?:add card|create task|todo)\s*:?\s*(.+)/i,type:'card'},
    {rx:/^(?:research|look up|find info)\s+(.{4,})/i,type:'research'},
    {rx:/^(?:report|issue|problem|broken|help)\s+(.+)/i,type:'report'},
    {rx:/^(?:clean sensitive|remove personal|scan sensitive|delete personal)\s*(.*)$/i,type:'sensitive'},
    {rx:/^(?:add cleaning task|new cleaning task|add task to cleaning)\s*:?\s*(.+)/i,type:'addClean'},
    {rx:/^(?:remove cleaning task|delete cleaning task)\s*:?\s*(.+)/i,type:'removeClean'}
  ];
  function detectTask(q){for(const p of TASK_RX){const m=q.match(p.rx);if(m)return{type:p.type,content:m[1]};}return null;}
  async function handleTask(task){
    if(task.type==='log'){const{error}=await NX.sb.from('daily_logs').insert({entry:task.content});return error?'Failed to log.':`Logged: "${task.content}"`;}
    if(task.type==='card'){const{error}=await NX.sb.from('kanban_cards').insert({title:task.content,column_name:'todo'});return error?'Failed.':`Card created: "${task.content}"`;}
    return null;
  }

  async function handleResearch(topic){
    const status=addB('🔍 '+tt('researchingWeb')+' "'+topic+'"...','ai thinking');
    let dots=0;const dotTimer=setInterval(()=>{dots=(dots+1)%4;status.textContent='🔍 '+tt('researchingWeb')+' "'+topic+'"'+'.'.repeat(dots);},500);
    try{
      const webResult=await NX.askClaude('You are a research assistant for restaurant operations (Suerte, Este, Bar Toti — Austin TX). Search the web and provide detailed, factual information. Include specs, model numbers, pricing, warranty, dealer contacts.',[{role:'user',content:`Research: ${topic}`}],2000,true);
      clearInterval(dotTimer);
      addB(webResult||'No results.','ai');
      chatHistory.push({role:'assistant',content:webResult});if(voiceOn)speak(webResult);
      // Quality check — skip extraction if AI just asked for clarification
      const isVague=!webResult||webResult.length<100||/could you|please specify|what would you like|need more|which specific/i.test(webResult);
      if(!isVague){
        const extractStatus=addB('⚙ '+tt('extractingKnowledge')+'...','ai thinking');
        const extractDots=setInterval(()=>{dots=(dots+1)%4;extractStatus.textContent='⚙ '+tt('extractingKnowledge')+'.'.repeat(dots);},500);
      const extraction=await NX.askClaude('Extract ALL knowledge as nodes. RESPOND ONLY RAW JSON: {"nodes":[{"name":"...","category":"equipment|contractors|vendors|procedure|projects|people|systems|parts|location","tags":["..."],"notes":"..."}]}',[{role:'user',content:webResult}],2000);
      let json=extraction.replace(/```json\s*/gi,'').replace(/```\s*/g,'');
      const s=json.indexOf('{'),e=json.lastIndexOf('}');
      if(s!==-1&&e>s){json=json.slice(s,e+1);const parsed=JSON.parse(json);
        if(parsed.nodes&&parsed.nodes.length){let created=0;
          const vc=['equipment','contractors','vendors','procedure','projects','people','systems','parts','location'];
          const ex=new Set(NX.nodes.map(n=>(n.name||'').toLowerCase()));
          for(const n of parsed.nodes){const nm=(n.name||'').trim();if(!nm||nm.length<2||ex.has(nm.toLowerCase()))continue;
            const{error}=await NX.sb.from('nodes').insert({name:nm.slice(0,200),category:vc.includes(n.category)?n.category:'equipment',tags:Array.isArray(n.tags)?n.tags.filter(x=>typeof x==='string').slice(0,20):[],notes:(n.notes||'').slice(0,2000),links:[],access_count:1,source_emails:[{from:'Web Research',subject:topic,date:new Date().toISOString().split('T')[0]}]});
            if(!error){created++;ex.add(nm.toLowerCase());}}
          addB(`✓ ${created} node${created!==1?'s':''} added to brain.`,'ai');
          clearInterval(extractDots);
          await NX.loadNodes();if(NX.brain)NX.brain.init();
        }else{clearInterval(extractDots);addB('No new nodes to extract.','ai');}
      }
      }else{addB(tt('tooVague'),'ai');}
      try{await NX.sb.from('chat_history').insert({question:'research: '+topic,answer:webResult,session_id:SESSION_ID});}catch(e){}
    }catch(e){clearInterval(dotTimer);addB(tt('researchFailed')+': '+(e.message||'error'),'ai');}
  }

  // ═══ ISSUE REPORTING — AI troubleshoot + ticket creation ═══
  async function handleReport(issue){
    const lang=NX.i18n?NX.i18n.getLang():'en';
    const userName=NX.currentUser?.name||'Unknown';
    const userLoc=NX.currentUser?.location||'suerte';

    // Step 1: AI quick troubleshoot
    addB(lang==='es'?'🔧 Analizando el problema...':'🔧 Analyzing the issue...','ai thinking');
    let troubleshoot='';
    try{
      troubleshoot=await NX.askClaude(
        `You are a restaurant equipment troubleshooting expert for Suerte, Este, Bar Toti (Austin TX).${lang==='es'?'\nRespond ONLY in Spanish.':''}
Give a quick 2-3 step troubleshooting guide for this issue. Be practical and concise.
After the troubleshoot steps, ask the person to add more details and optionally take a photo so the issue can be logged as a ticket.`,
        [{role:'user',content:issue}],600);
      addB(troubleshoot,'ai');chatHistory.push({role:'assistant',content:troubleshoot});
    }catch(e){
      addB(lang==='es'?'No pude analizar el problema.':'Could not analyze the issue.','ai');
    }

    // Step 2: Show ticket form inline
    const form=document.createElement('div');form.className='ticket-form';
    form.innerHTML=`
      <div class="ticket-form-title">📋 ${lang==='es'?'Crear Ticket':'Create Ticket'}</div>
      <div class="ticket-field-label">${lang==='es'?'Descripción':'Description'}</div>
      <textarea class="ticket-textarea" id="ticketNotes" rows="3" placeholder="${lang==='es'?'Describe el problema con más detalle...':'Describe the issue in more detail...'}">${issue}</textarea>
      <div class="ticket-field-label">${lang==='es'?'Prioridad':'Priority'}</div>
      <div class="ticket-priority-row">
        <button class="ticket-pri-btn" data-pri="low">🟢 ${lang==='es'?'Baja':'Low'}</button>
        <button class="ticket-pri-btn active" data-pri="normal">🟡 ${lang==='es'?'Normal':'Normal'}</button>
        <button class="ticket-pri-btn" data-pri="urgent">🔴 ${lang==='es'?'Urgente':'Urgent'}</button>
      </div>
      <div class="ticket-field-label">${lang==='es'?'Foto (opcional)':'Photo (optional)'}</div>
      <label class="ticket-photo-btn"><input type="file" accept="image/*" capture="environment" hidden id="ticketPhoto">📷 ${lang==='es'?'Tomar Foto / Subir':'Take Photo / Upload'}</label>
      <div class="ticket-photo-preview" id="ticketPreview"></div>
      <button class="ticket-submit-btn" id="ticketSubmitBtn">📋 ${lang==='es'?'Enviar Ticket':'Submit Ticket'}</button>
      <div class="ticket-status" id="ticketStatus"></div>`;

    const msgs=document.getElementById('chatMessages');msgs.appendChild(form);
    msgs.scrollTop=msgs.scrollHeight;

    // Priority selection
    let priority='normal';
    form.querySelectorAll('.ticket-pri-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        form.querySelectorAll('.ticket-pri-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');priority=btn.dataset.pri;
      });
    });

    // Photo handling
    let photoUrl='';
    const photoInput=form.querySelector('#ticketPhoto');
    const preview=form.querySelector('#ticketPreview');
    photoInput.addEventListener('change',async()=>{
      const file=photoInput.files[0];if(!file)return;
      preview.innerHTML='<div style="color:var(--muted);font-size:11px">Uploading...</div>';
      try{
        const ts=Date.now();const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
        const path=`tickets/${ts}_${safeName}`;
        const{error}=await NX.sb.storage.from('nexus-files').upload(path,file,{contentType:file.type,upsert:true});
        if(!error){
          const{data}=NX.sb.storage.from('nexus-files').getPublicUrl(path);
          photoUrl=data?.publicUrl||'';
          preview.innerHTML=`<img src="${photoUrl}" class="ticket-photo-img">`;
        }else{preview.innerHTML='<div style="color:#ff5533;font-size:11px">Upload failed</div>';}
      }catch(e){preview.innerHTML='<div style="color:#ff5533;font-size:11px">Error</div>';}
    });

    // Submit
    form.querySelector('#ticketSubmitBtn').addEventListener('click',async()=>{
      const notes=form.querySelector('#ticketNotes').value.trim();
      if(!notes){form.querySelector('#ticketStatus').textContent=lang==='es'?'Escribe una descripción':'Please add a description';return;}
      const submitBtn=form.querySelector('#ticketSubmitBtn');
      submitBtn.disabled=true;submitBtn.textContent=lang==='es'?'Enviando...':'Submitting...';
      try{
        const{error}=await NX.sb.from('tickets').insert({
          title:notes.slice(0,100),notes,location:userLoc,
          reported_by:userName,status:'open',priority,
          photo_url:photoUrl,ai_troubleshoot:troubleshoot
        });
        if(!error){
          submitBtn.textContent='✓';
          form.querySelector('#ticketStatus').textContent=lang==='es'?'✓ Ticket creado':'✓ Ticket submitted';
          form.querySelector('#ticketStatus').style.color='#39ff14';
          addB(lang==='es'?`✓ Ticket registrado: "${notes.slice(0,60)}"`:`✓ Ticket logged: "${notes.slice(0,60)}"`,'ai');
          // Also log to daily log
          await NX.sb.from('daily_logs').insert({entry:`🔧 TICKET [${priority.toUpperCase()}] by ${userName} @ ${userLoc}: ${notes.slice(0,200)}${photoUrl?' [photo attached]':''}`});
          updateTicketBadge();
        }else{
          submitBtn.textContent=lang==='es'?'Error':'Error';
          form.querySelector('#ticketStatus').textContent=error.message;
        }
      }catch(e){submitBtn.textContent='Error';}
    });
  }

  async function updateTicketBadge(){
    try{
      const{count}=await NX.sb.from('tickets').select('*',{count:'exact',head:true}).eq('status','open');
      const badge=document.getElementById('ticketBadge');
      if(badge){badge.textContent=count||'';badge.style.display=count?'flex':'none';}
    }catch(e){}
  }

  async function handleSensitiveScan(){
    addB('Scanning all nodes for personal/sensitive data...','ai thinking');
    try{
      const nodes=NX.nodes.filter(n=>!n.is_private);
      const nodeList=nodes.map(n=>`[ID:${n.id}] ${n.name} (${n.category}): ${(n.notes||'').slice(0,150)}`).join('\n');
      const result=await NX.askClaude('Scan these restaurant ops nodes for PERSONAL/SENSITIVE data: bonuses, salaries, SSNs, personal addresses, bank info, performance reviews. Do NOT flag business contacts, vendor info, equipment, procedures. Return JSON: {"flagged":[{"id":"...","name":"...","reason":"..."}]}',[{role:'user',content:nodeList.slice(0,12000)}],2000);
      let json=result.replace(/```json\s*/gi,'').replace(/```\s*/g,'');
      const s=json.indexOf('{'),e=json.lastIndexOf('}');
      if(s!==-1&&e>s){json=json.slice(s,e+1);const parsed=JSON.parse(json);
        if(parsed.flagged&&parsed.flagged.length){
          let msg=`Found ${parsed.flagged.length} potentially sensitive node(s):\n\n`;
          parsed.flagged.forEach(f=>{msg+=`• ${f.name} — ${f.reason}\n`;});
          msg+='\nGo to Ingest → "Scan & Remove Personal Data" to review and delete.';
          addB(msg,'ai');
        }else addB('✅ No sensitive data found. Your brain is clean.','ai');
      }else addB('Scan complete — no issues found.','ai');
    }catch(e){addB('Scan error: '+e.message,'ai');}
  }

  async function handleAddCleanTask(content){
    addB('Processing cleaning task...','ai thinking');
    try{
      const result=await NX.askClaude(
        'Parse this cleaning task request for a restaurant (Suerte, Este, Toti). Return ONLY JSON: {"location":"suerte|este|toti","section":"Comedor|Baños|Exterior|Cocina|Jardín","es":"Spanish task text","en":"English task text"}',
        [{role:'user',content}],300);
      let json=result.replace(/```json\s*/gi,'').replace(/```\s*/g,'');
      const s=json.indexOf('{'),e=json.lastIndexOf('}');
      if(s!==-1&&e>s){json=json.slice(s,e+1);const p=JSON.parse(json);
        if(p.location&&p.section&&p.es&&p.en&&NX.cleaningAPI){
          NX.cleaningAPI.addTask(p.location,p.section,p.es,p.en);
          addB(`✓ Added to ${p.location} → ${p.section}:\n${p.es}\n${p.en}`,'ai');
        }else addB('Could not parse task. Try: "add cleaning task: sweep patio at suerte exterior"','ai');
      }else addB('Could not parse. Try: "add cleaning task: [description] at [location] [section]"','ai');
    }catch(e){addB('Error: '+e.message,'ai');}
  }

  async function handleRemoveCleanTask(content){
    if(NX.cleaningAPI){
      // Try all locations
      let removed=false;
      for(const loc of NX.cleaningAPI.getLocations()){
        if(NX.cleaningAPI.removeTask(loc,content)){removed=true;break;}
      }
      if(removed)addB(`✓ Removed cleaning task matching "${content}".`,'ai');
      else addB(`No custom task found matching "${content}". Note: only AI-added tasks can be removed.`,'ai');
    }else addB('Cleaning module not loaded.','ai');
  }

  function setupChat(){
    const i=document.getElementById('chatInput'),s=document.getElementById('chatSend'),hud=document.getElementById('chatHud'),dim=document.getElementById('brainDim'),r=document.getElementById('resetBtn'),chev=document.getElementById('hudChevron');
    chev.addEventListener('click',()=>{hud.classList.toggle('collapsed');});
    i.addEventListener('input',()=>{s.disabled=!i.value.trim();});
    i.addEventListener('focus',()=>{if(hud.classList.contains('collapsed'))hud.classList.remove('collapsed');dim.classList.add('active');});
    i.addEventListener('blur',()=>{if(!i.value.trim()&&!chatActive)dim.classList.remove('active');});
    i.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();askAI();}});
    s.addEventListener('click',askAI);r.addEventListener('click',resetChat);
    document.querySelectorAll('.brain-ex').forEach(b=>b.addEventListener('click',()=>{i.value=b.textContent;s.disabled=false;askAI();}));
    checkApiKey();buildDynamicChips();
    if(localStorage.getItem('nexus_voice_seen')){const l=document.getElementById('micLabel');if(l)l.classList.add('hidden');}
    else localStorage.setItem('nexus_voice_seen','1');
    setupVoice();
    window.addEventListener('online',()=>{document.getElementById('offlineBanner').style.display='none';});
    window.addEventListener('offline',()=>{document.getElementById('offlineBanner').style.display='block';});
    if(!navigator.onLine)document.getElementById('offlineBanner').style.display='block';
    // Onboarding check
    if(!localStorage.getItem('nexus_onboarded')&&!NX.getApiKey()){showOnboarding();}
  }

  function resetChat(){chatHistory=[];chatActive=false;document.getElementById('chatMessages').innerHTML='';document.getElementById('brainWelcome').style.display='';document.getElementById('brainExamples').style.display='';document.getElementById('brainDim').classList.remove('active');document.getElementById('resetBtn').style.display='none';NX.brain.state.activatedNodes=new Set();NX.brain.wakePhysics();}

  async function getCtx(q){
    // Always fetch fresh nodes from Supabase
    await NX.loadNodes();
    const w=q.toLowerCase().split(/\s+/).filter(x=>x.length>1);
    const qLow=q.toLowerCase();
    const sc=NX.nodes.filter(n=>!n.is_private).map(n=>{
      let s=0;
      const name=(n.name||'').toLowerCase();
      const notes=(n.notes||'').toLowerCase();
      const tags=(n.tags||[]).join(' ').toLowerCase();
      const all=name+' '+n.category+' '+tags+' '+notes;
      // Exact name match — highest priority
      if(name===qLow)s+=50;
      // Name contains query or query contains name
      else if(name.includes(qLow)||qLow.includes(name))s+=20;
      // Partial word matches
      w.forEach(x=>{
        if(name.includes(x))s+=8;
        if(tags.includes(x))s+=4;
        if(notes.includes(x))s+=2;
      });
      return{node:n,score:s};
    }).filter(s=>s.score>0).sort((a,b)=>b.score-a.score);
    const rel=sc.slice(0,15).map(s=>s.node);
    // Send ALL node names (not just 200) so AI knows everything
    const idx=NX.nodes.filter(n=>!n.is_private).map(n=>`${n.name} (${n.category})`).join(', ');
    const det=rel.map(n=>{let src='';const sources=n.sources||n.source_emails;if(sources&&sources.length)src=' [Sources: '+sources.map(s=>`${s.from} "${s.subject}" ${s.date}`).join('; ')+']';return`[${n.category}] ${n.name}: ${(n.notes||'').slice(0,500)}${src}`;}).join('\n');
    const relIds=rel.map(n=>n.id);
    NX.brain.state.activatedNodes=new Set(relIds);NX.brain.wakePhysics();
    setTimeout(()=>{NX.brain.state.activatedNodes=new Set();},12000);
    NX.trackAccess(relIds);
    const memory=await NX.fetchMemory(q);
    const ce=NX.brain.state.contractorEvents;
    let ev='';if(ce&&ce.length)ev='\n\nUPCOMING:\n'+ce.slice(0,8).map(e=>`${e.contractor_name} @ ${e.location||'?'} ${e.event_date}`).join('\n');
    return`RELEVANT NODES:\n${det}\n\nFULL INDEX (${NX.nodes.length} nodes):\n${idx}${memory}${ev}`;
  }

  async function askAI(){
    if(!navigator.onLine){addB("Can't reach NEXUS — check WiFi.",'ai');return;}
    const i=document.getElementById('chatInput'),q=i.value.trim();if(!q)return;
    i.value='';document.getElementById('chatSend').disabled=true;
    document.getElementById('brainWelcome').style.display='none';
    document.getElementById('brainExamples').style.display='none';
    document.getElementById('brainDim').classList.add('active');
    document.getElementById('chatHud').classList.add('expanded');
    document.getElementById('chatHud').classList.remove('collapsed');
    document.getElementById('resetBtn').style.display='';
    chatActive=true;addB(q,'user');chatHistory.push({role:'user',content:q});
    if(!NX.getApiKey()){addB(tt('noApiKey'),'ai');return;}
    const task=detectTask(q);
    if(task){
      if(task.type==='research'){try{await handleResearch(task.content);}catch(e){addB('Research error: '+e.message,'ai');}return;}
      if(task.type==='report'){try{await handleReport(task.content);}catch(e){addB('Report error: '+e.message,'ai');}return;}
      if(task.type==='sensitive'){await handleSensitiveScan();return;}
      if(task.type==='addClean'){await handleAddCleanTask(task.content);return;}
      if(task.type==='removeClean'){await handleRemoveCleanTask(task.content);return;}
      try{const result=await handleTask(task);if(result){addB(result,'ai');chatHistory.push({role:'assistant',content:result});if(voiceOn)speak(result);try{await NX.sb.from('chat_history').insert({question:q,answer:result,session_id:SESSION_ID});}catch(e){}return;}}catch(e){addB('Task error: '+e.message,'ai');return;}
    }
    const th=addB('🔍 '+tt('searching')+' '+NX.nodes.length+' '+tt('nodes')+'...','ai thinking');
    let sd=0;const searchDots=setInterval(()=>{sd=(sd+1)%4;th.textContent='🔍 '+tt('searching')+' '+NX.nodes.length+' '+tt('nodes')+'.'.repeat(sd);},400);
    try{
      const ctx=await getCtx(q);
      const msgs=chatHistory.slice(-6).map(m=>({role:m.role==='user'?'user':'assistant',content:m.content}));
      const ans=await NX.askClaude(getPERSONA()+'\n\n'+ctx,msgs,800,false);
      clearInterval(searchDots);
      th.textContent=ans||'No response.';th.classList.remove('chat-thinking');
      // Add timestamp
      const ts=document.createElement('span');ts.className='chat-time';ts.textContent=timeStr();th.appendChild(ts);
      chatHistory.push({role:'assistant',content:ans});if(voiceOn)speak(ans);
      try{await NX.sb.from('chat_history').insert({question:q,answer:ans,session_id:SESSION_ID});}catch(e){}
    }catch(e){clearInterval(searchDots);th.textContent='Error: '+(e.message||'Unknown');th.classList.remove('chat-thinking');}
  }

  function addB(t,type){
    const el=document.createElement('div');
    el.className='chat-bubble chat-'+(type.includes('user')?'user':'ai');
    if(type.includes('thinking'))el.classList.add('chat-thinking');
    el.textContent=t;
    // Timestamp on non-thinking messages
    if(!type.includes('thinking')){
      const ts=document.createElement('span');ts.className='chat-time';ts.textContent=timeStr();el.appendChild(ts);
    }
    const c=document.getElementById('chatMessages');c.appendChild(el);c.scrollTop=c.scrollHeight;return el;
  }

  // Onboarding
  function showOnboarding(){
    const ov=document.createElement('div');ov.className='onboard-overlay';
    ov.innerHTML=`<div class="onboard-box">
      <div class="onboard-dot"></div>
      <h2 class="onboard-title">Welcome to NEXUS</h2>
      <p class="onboard-desc">Your AI-powered operations brain for Suerte, Este & Bar Toti.</p>
      <div class="onboard-steps">
        <div class="onboard-step"><span class="onboard-num">1</span>Open <b>Admin ⚙</b> and add your Anthropic API key</div>
        <div class="onboard-step"><span class="onboard-num">2</span>Ask NEXUS anything — or use <b>Ingest</b> to pull in emails</div>
        <div class="onboard-step"><span class="onboard-num">3</span>Try <b>"research [topic]"</b> for live web lookups</div>
      </div>
      <button class="onboard-btn" id="onboardDismiss">Got it — let's go</button>
    </div>`;
    document.body.appendChild(ov);
    document.getElementById('onboardDismiss').addEventListener('click',()=>{
      localStorage.setItem('nexus_onboarded','1');ov.remove();
    });
  }

  // Voice
  let pv=null;
  const VOICES=[{id:'pNInz6obpgDQGcFmaJgB',name:'Adam'},{id:'EXAVITQu4vr4xnSDxMaL',name:'Bella'},{id:'onwK4e9ZLuTAKqWW03F9',name:'Daniel'},{id:'XB0fDUnXU5powFXDhCwa',name:'Charlotte'},{id:'TX3LPaxmHKxFdv7VOQHJ',name:'Liam'},{id:'LcfcDJNUP1GQjkzn1xUU',name:'Emily'},{id:'yoZ06aMxZJJ28mfd3POQ',name:'Sam'},{id:'ThT5KcBeYPX3keUQqHPh',name:'Dorothy'},{id:'VR6AewLTigWG4xSOukaG',name:'Arnold'},{id:'pqHfZKP75CvOlQylNhV4',name:'Bill'},{id:'ErXwobaYiN019PkySvjV',name:'Antoni'},{id:'AZnzlk1XvdvUeBnXmlld',name:'Domi'},{id:'D38z5RcWu1voky8WS1ja',name:'Fin'},{id:'jsCqWAovK2LkecY7zXl4',name:'Freya'},{id:'jBpfuIE2acCO8z3wKNLl',name:'Gigi'},{id:'oWAxZDx7w5VEj9dCyTzz',name:'Grace'},{id:'SOYHLrjzK2X1ezoPC6cr',name:'Harry'},{id:'ZQe5CZNOzWyzPSCn5a3c',name:'James'},{id:'TxGEqnHWrfWFTfGW9XjX',name:'Josh'},{id:'21m00Tcm4TlvDq8ikWAM',name:'Rachel'}];
  let cvi=parseInt(NX.config?.voice_idx??localStorage.getItem('nexus_voice_idx')?? '0')%VOICES.length;
  function setupVoice(){document.getElementById('micBtn').addEventListener('click',toggleMic);const vb=document.getElementById('voiceBtn');let pt=null;vb.addEventListener('click',()=>{voiceOn=!voiceOn;vb.classList.toggle('on',voiceOn);});vb.addEventListener('pointerdown',()=>{pt=setTimeout(()=>{cvi=(cvi+1)%VOICES.length;localStorage.setItem('nexus_voice_idx',cvi);voiceOn=true;vb.classList.add('on');speak(`${VOICES[cvi].name} here.`);pt=null;},600);});vb.addEventListener('pointerup',()=>{if(pt)clearTimeout(pt);});vb.addEventListener('pointerleave',()=>{if(pt)clearTimeout(pt);});if('speechSynthesis'in window){const pk=()=>{const v=speechSynthesis.getVoices();for(const n of['Samantha','Karen','Daniel','Microsoft Aria']){const f=v.find(x=>x.name.includes(n));if(f){pv=f;break;}}};pk();speechSynthesis.onvoiceschanged=pk;}}
  function toggleMic(){const b=document.getElementById('micBtn');if(recognition){recognition.stop();recognition=null;b.classList.remove('recording');return;}if(!('webkitSpeechRecognition'in window||'SpeechRecognition'in window))return;const SR=window.SpeechRecognition||window.webkitSpeechRecognition;recognition=new SR();recognition.continuous=false;recognition.interimResults=false;recognition.onresult=e=>{document.getElementById('chatInput').value=e.results[0][0].transcript;document.getElementById('chatSend').disabled=false;b.classList.remove('recording');recognition=null;askAI();};recognition.onerror=()=>{b.classList.remove('recording');recognition=null;};recognition.onend=()=>{b.classList.remove('recording');recognition=null;};b.classList.add('recording');recognition.start();}
  async function speak(text){const ek=NX.getElevenLabsKey();if(ek){try{const r=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICES[cvi].id}`,{method:'POST',headers:{'Content-Type':'application/json','xi-api-key':ek},body:JSON.stringify({text:text.slice(0,800),model_id:'eleven_turbo_v2',voice_settings:{stability:.45,similarity_boost:.78,style:.35,use_speaker_boost:true}})});if(r.ok){const bl=await r.blob(),u=URL.createObjectURL(bl),a=new Audio(u);a.play();a.onended=()=>URL.revokeObjectURL(u);return;}}catch(e){}}if(!('speechSynthesis'in window))return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text.slice(0,600));if(pv)u.voice=pv;u.rate=.95;speechSynthesis.speak(u);}

  NX.brain.initChat=setupChat;
})();
