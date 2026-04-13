/* NEXUS Brain Chat v10 — Deep reasoning, glossary, location context, temporal awareness */
(function(){
  if(!localStorage.getItem('nexus_session_id'))localStorage.setItem('nexus_session_id',crypto.randomUUID?crypto.randomUUID():'s_'+Date.now()+'_'+Math.random().toString(36).slice(2));
  const SESSION_ID=localStorage.getItem('nexus_session_id');
  let chatHistory=[],voiceOn=true,recognition=null,chatActive=false;
  function tt(k){return NX.i18n?NX.i18n.t(k):k;}

  const PERSONA_BASE=`You are NEXUS, the personal assistant for Suerte, Este, and Bar Toti in Austin. You're calm, warm, and a little flirty. Not bubbly. Not excited. Think chill confidence — you know your stuff and you don't need to prove it.

HOW YOU TALK:
- Calm and short. 1-2 sentences max for simple questions. 3 tops for complex stuff.
- Warm but never over-the-top. A casual "nice" or "got it, love" is fine. Never multiple exclamation marks or enthusiasm.
- Never use asterisks, bold, bullets, numbered lists, or markdown. Plain text only.
- Never start with "Great question" or "I'd be happy to" or "Absolutely!" — just answer.
- Use contractions. Keep it natural.
- Never say "based on my data" or "according to my records." You just know.
- Never use anyone's name.
- Be brief. If the answer is one sentence, give one sentence. Don't pad.

YOUR ROLE:
- You're a personal assistant, not just an ops manager. You remind, update, and keep things organized.
- Proactively mention upcoming deadlines, contractor visits, expiring items.
- When asked about schedules, give times and details confidently.
- If something needs attention, flag it with a little urgency but keep it light.

IDENTITY:
- Alfredo "Ders" Ortiz runs all three spots
- You remember past conversations and reference them naturally

KNOWLEDGE RULES:
- If info is older than 60 days, mention it casually: "last I heard back in March, might wanna double check that"
- If two sources disagree, mention both and which is newer
- Never make up phone numbers, prices, part numbers, or dates
- For equipment, include model numbers and part numbers when you have them
- When MEMORY PALACE data is available, follow connections between zones — don't just answer from one zone, trace how things connect
- Mention bridge connections when they add useful context: "that vendor also connects to your equipment through..."
- If a node is marked [central node], it's the most important entity in its zone
- If a node is marked [bridge between zones], it connects different areas of knowledge
- Verified links (extracted) are more reliable than inferred ones
- "deep dive" means walk the full palace — explore every connected zone and bridge

CONFIDENCE:
- End every response with: [confidence:high] [confidence:medium] or [confidence:low]

RESTAURANT GLOSSARY:
{GLOSSARY}

EQUIPMENT SOURCING:
- Parts Town for branded parts like Hoshizaki and True
- WebstaurantStore for general supplies
- Amazon for commodity stuff
- Grainger for industrial

COMMANDS (mention when relevant):
- "look up [topic]" for web search
- "remember [name] - [details]" to save info
- "log that [text]" for daily log
- "report [issue]" for maintenance ticket
- "add card: [task]" for the board

You CANNOT search the web yourself. User must type "look up" or "investigate".`;

  function getPERSONA(){
    const lang=NX.i18n?NX.i18n.getLang():'en';
    let persona=PERSONA_BASE;

    // Inject glossary
    const glossary=NX._glossary||[];
    if(glossary.length){
      const glossStr=glossary.map(g=>`${g.term} → ${g.meaning}`).join('\n');
      persona=persona.replace('{GLOSSARY}',glossStr);
    }else{
      persona=persona.replace('{GLOSSARY}','(No glossary entries yet. Staff can add terms via Admin.)');
    }

    // Inject critical facts
    const facts=NX._criticalFacts||[];
    if(facts.length){
      persona+='\n\nCRITICAL FACTS (always true, verified):\n'+facts.map(f=>`• ${f.content}`).join('\n');
    }

    // Inject user identity + location + personality
    if(NX.currentUser){
      const u=NX.currentUser;
      const loc=localStorage.getItem('nexus_last_location')||u.location||'unknown';
      persona+=`\n\nCURRENT LOCATION: ${loc.toUpperCase()}`;
      const now=new Date();
      const hour=now.getHours();
      const shift=hour<11?'morning':hour<16?'afternoon':'evening';
      const dayName=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()];
      persona+=`\nTIME: ${dayName} ${shift}, ${now.toLocaleDateString()} ${now.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`;

      // Match the team's energy
      persona+=`\n\nPERSONALITY MATCH:
- Warm, playful, a little flirty. You're the assistant everyone wants.
- Keep answers tight. If they ask a yes/no, answer yes or no first, then explain if needed.
- Don't over-explain. They'll ask if they want more.
- Never use anyone's name in your responses.
- Be confident. Say "yeah that's the Hoshizaki compressor" not "it appears to be related to the Hoshizaki compressor"
- Toss in a casual compliment when they're on top of things. "Look at you" or "nice" works.
- When something's wrong, still be direct but keep it warm: "hey heads up, the walk-in temp is off"
- Use restaurant lingo naturally: BOH, FOH, 86'd, covers, ticket times, line, expo, walk-in
- Bilingual — if they switch to Spanish, switch with them
- Late night questions get shorter, softer answers
- If they say "deep dive" go thorough
- Never say "I understand your concern" or "that's a great point" — just get to it`;
    }

    if(lang==='es')persona+='\n\nRespond ONLY in Spanish.';
    return persona;
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
    {rx:/^(?:research|look up|look into|investigate|search for|find out about|dig into|find info on|find info about)\s+(.{3,})/i,type:'research'},
    {rx:/^(?:report|issue|problem|broken|help)\s+(.+)/i,type:'report'},
    {rx:/^(?:remember|save|add node|create node|note about)\s*:?\s*(.+)/i,type:'createNode'},
    {rx:/^(?:clean sensitive|remove personal|scan sensitive|delete personal)\s*(.*)$/i,type:'sensitive'},
    {rx:/^(?:add cleaning task|new cleaning task|add task to cleaning)\s*:?\s*(.+)/i,type:'addClean'},
    {rx:/^(?:remove cleaning task|delete cleaning task)\s*:?\s*(.+)/i,type:'removeClean'},
    {rx:/^(?:weekly digest|digest|weekly report|week report|how was the week)\s*(.*)$/i,type:'digest'},
    {rx:/^(?:reminders|smart reminders|what did I forget|unresolved|follow ups|what's pending)\s*(.*)$/i,type:'reminders'}
  ];
  function detectTask(q){for(const p of TASK_RX){const m=q.match(p.rx);if(m)return{type:p.type,content:m[1]};}return null;}
  async function handleTask(task){
    if(task.type==='log'){const{error}=await NX.sb.from('daily_logs').insert({entry:task.content});return error?'Failed to log.':`Logged: "${task.content}"`;}
    if(task.type==='card'){const{error}=await NX.sb.from('kanban_cards').insert({title:task.content,column_name:'todo'});return error?'Failed.':`Card created: "${task.content}"`;}
    if(task.type==='digest'){addB('📊 Generating weekly digest...','ai');if(NX.modules.admin){const el=document.getElementById('ingestLog');if(el)el.innerHTML='';document.getElementById('digestBtn')?.click();}else{addB('Switch to Ingest tab and tap 📊 Weekly Digest','ai');}return null;}
    if(task.type==='reminders'){addB('🧠 Scanning for unresolved items...','ai');if(NX.modules.admin){const el=document.getElementById('ingestLog');if(el)el.innerHTML='';document.getElementById('remindersBtn')?.click();}else{addB('Switch to Ingest tab and tap 🧠 Smart Reminders','ai');}return null;}
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
            if(!error){created++;ex.add(nm.toLowerCase());}else{console.error('Node insert failed:',nm,error.message);addB(`⚠ Failed to save "${nm}": ${error.message}`,'ai');}}
          addB(`✓ ${created} node${created!==1?'s':''} added to brain.`,'ai');
          clearInterval(extractDots);
          await NX.loadNodes();if(NX.brain)NX.brain.init();
        }else{clearInterval(extractDots);addB('No new nodes to extract.','ai');}
      }
      }else{addB(tt('tooVague'),'ai');}
      try{await NX.sb.from('chat_history').insert({question:'research: '+topic,answer:webResult,session_id:SESSION_ID,user_name:(NX.currentUser?NX.currentUser.name:'Unknown')});}catch(e){}
    }catch(e){clearInterval(dotTimer);addB(tt('researchFailed')+': '+(e.message||'error'),'ai');}
  }

  // ═══ DIRECT NODE CREATION from chat ═══
  async function handleCreateNode(text){
    addB('💾 Creating node...','ai thinking');
    try{
      const result=await NX.askClaude(
        'Extract ONE knowledge node from this text. Return ONLY raw JSON: {"name":"...","category":"equipment|contractors|vendors|procedure|projects|people|systems|parts|location","tags":["..."],"notes":"detailed notes with all info provided"}',
        [{role:'user',content:text}],500);
      let json=result.replace(/```json\s*/gi,'').replace(/```\s*/g,'');
      const s=json.indexOf('{'),e=json.lastIndexOf('}');
      if(s===-1||e<=s){addB('Could not parse node from that. Try: "remember Ders - award winning CIA trained chef at Suerte"','ai');return;}
      json=json.slice(s,e+1);
      const node=JSON.parse(json);
      const nm=(node.name||'').trim();
      if(!nm||nm.length<2){addB('Need a name. Try: "remember [name] - [details]"','ai');return;}

      const vc=['equipment','contractors','vendors','procedure','projects','people','systems','parts','location'];
      const row={
        name:nm.slice(0,200),
        category:vc.includes(node.category)?node.category:'people',
        tags:Array.isArray(node.tags)?node.tags.filter(t=>typeof t==='string').slice(0,20):[],
        notes:(node.notes||text).slice(0,2000),
        links:[],access_count:1,
        source_emails:[{from:NX.currentUser?.name||'Chat',subject:'Created via chat',date:new Date().toISOString().split('T')[0]}],
        owner_id:NX.brainView==='mine'?(NX.currentUser?.id||null):null
      };

      // Check for duplicate
      const existing=NX.nodes.find(n=>n.name.toLowerCase()===nm.toLowerCase());
      if(existing){
        // Update existing node — append notes
        const newNotes=(existing.notes||'')+'\n\n[Updated '+new Date().toLocaleDateString()+']\n'+(node.notes||text);
        const{error}=await NX.sb.from('nodes').update({notes:newNotes.slice(0,4000)}).eq('id',existing.id);
        if(error){addB('❌ Update failed: '+error.message,'ai');return;}
        existing.notes=newNotes;
        addB(`✓ Updated existing node "${nm}" with new info.`,'ai');
      }else{
        const{error}=await NX.sb.from('nodes').insert(row);
        if(error){addB('❌ Insert failed: '+error.message,'ai');return;}
        addB(`✓ Node created: "${nm}" (${row.category})\n📝 ${(row.notes||'').slice(0,150)}`,'ai');
      }

      await NX.loadNodes();
      if(NX.brain)NX.brain.init();
      chatHistory.push({role:'assistant',content:`Created/updated node: ${nm}`});
    }catch(e){
      addB('❌ Failed: '+e.message,'ai');
    }
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
    // Handle toggles chat
    chev.addEventListener('click',()=>{
      if(hud.classList.contains('expanded')){hud.classList.remove('expanded');dim.classList.remove('active');stopSpeaking();}
      else{hud.classList.add('expanded');dim.classList.add('active');if(NX.brain&&NX.brain.closePanel)NX.brain.closePanel();}
    });
    i.addEventListener('input',()=>{s.disabled=!i.value.trim();});
    // Focus expands chat
    i.addEventListener('focus',()=>{hud.classList.add('expanded');dim.classList.add('active');
      // Close node panel if open
      if(NX.brain&&NX.brain.closePanel)NX.brain.closePanel();
      requestAnimationFrame(()=>{const c=document.getElementById('chatMessages');if(c)c.scrollTop=c.scrollHeight;});
    });
    i.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();askAI();}});
    s.addEventListener('click',askAI);r.addEventListener('click',resetChat);
    document.querySelectorAll('.brain-ex').forEach(b=>b.addEventListener('click',()=>{i.value=b.textContent;s.disabled=false;askAI();}));
    checkApiKey();buildDynamicChips();
    setupVoice();
    setupCamera();
    window.addEventListener('online',()=>{document.getElementById('offlineBanner').style.display='none';});
    window.addEventListener('offline',()=>{document.getElementById('offlineBanner').style.display='block';});
    if(!navigator.onLine)document.getElementById('offlineBanner').style.display='block';
    if(!localStorage.getItem('nexus_onboarded')&&!NX.getApiKey()){showOnboarding();}
    // Proactive greeting after briefing data loads
    setTimeout(()=>proactiveGreeting(),3500);
  }

  async function proactiveGreeting(){
    if(!NX.getApiKey()||!NX.currentUser)return;
    const b=NX._briefingData;if(!b)return;

    // Build a natural briefing string from real data
    const lines=[];
    const user=NX.currentUser.name.split(' ')[0]; // First name
    const hour=new Date().getHours();
    const greeting=hour<12?'Morning':hour<17?'Afternoon':'Evening';

    // Contractors today — most urgent
    if(b.contractors&&b.contractors.length){
      lines.push(b.contractors.map(e=>`**${e.contractor_name}**${e.event_time?' at '+e.event_time:''}${e.location?' ('+e.location+')':''}`).join(', ')+' — on site today');
    }

    // Open tickets
    if(b.tickets&&b.tickets.length){
      const urgent=b.tickets.slice(0,3);
      lines.push(`${b.tickets.length} open ticket${b.tickets.length>1?'s':''}: ${urgent.map(t=>t.title).join(', ')}${b.tickets.length>3?' +more':''}`);
    }

    // Hours worked this week
    if(b.hours&&Object.keys(b.hours).length){
      const sorted=Object.entries(b.hours).sort((a,b)=>b[1]-a[1]);
      const top=sorted.slice(0,4).map(([name,hrs])=>`${name} ${Math.round(hrs)}h`).join(', ');
      lines.push(`Hours this week: ${top}`);
    }

    // Cleaning scores
    if(b.cleaning&&Object.keys(b.cleaning).length){
      const scores=Object.entries(b.cleaning).map(([loc,d])=>`${loc} ${d.avg}%`).join(', ');
      lines.push(`Cleaning avg: ${scores}`);
    }

    // Clock status — removed, not needed
    // if(!b.clockedIn)lines.push(`You're not clocked in`);

    // Queue
    if(b.queue>20)lines.push(`${b.queue} emails in processing queue`);

    if(!lines.length)return; // Nothing to report

    // Use Claude to generate a natural greeting from the data
    try{
      const prompt=`You are NEXUS, a warm and slightly flirty personal assistant for restaurants. Generate a brief, natural update. Be playful but informative. 2-3 sentences max. Don't use anyone's name. Use the data below. If something needs attention, lead with that.

DATA:
${lines.join('\n')}

Keep it casual and warm. No markdown formatting.`;

      const resp=await fetch('https://api.anthropic.com/v1/messages',{
        method:'POST',
        headers:{'Content-Type':'application/json','x-api-key':NX.getApiKey(),'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
        body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:200,messages:[{role:'user',content:prompt}]})
      });
      const data=await resp.json();
      const msg=data.content?.[0]?.text;
      if(msg&&msg.length>10){
        // Show as first chat message — not in expanded mode, just peek
        const welcome=document.getElementById('brainWelcome');
        if(welcome){
          welcome.innerHTML=`<div class="proactive-greeting">${msg.replace(/\*\*(.*?)\*\*/g,'<b>$1</b>')}</div>`;
          welcome.style.display='';
        }
      }
    }catch(e){
      // Fallback — show raw data greeting without Claude
      const welcome=document.getElementById('brainWelcome');
      if(welcome){
        welcome.innerHTML=`<div class="proactive-greeting">${greeting}! ${lines.slice(0,3).join(' · ')}</div>`;
        welcome.style.display='';
      }
    }
  }

  function resetChat(){stopSpeaking();chatHistory=[];chatActive=false;document.getElementById('chatMessages').innerHTML='';document.getElementById('brainWelcome').style.display='';document.getElementById('brainExamples').style.display='';document.getElementById('brainDim').classList.remove('active');document.getElementById('resetBtn').style.display='none';document.getElementById('chatHud').classList.remove('expanded');NX.brain.state.activatedNodes=new Set();NX.brain.wakePhysics();}

  async function getCtx(q){
    await NX.loadNodes();
    const w=q.toLowerCase().split(/\s+/).filter(x=>x.length>2);
    const qLow=q.toLowerCase();
    const userLoc=(localStorage.getItem('nexus_last_location')||NX.currentUser?.location||'').toLowerCase();
    const aliases=NX._aliases||{};
    const now=Date.now();

    // Resolve aliases — "Tyler" also matches "Tyler Maffi"
    const expandedTerms=new Set(w);
    w.forEach(word=>{
      Object.entries(aliases).forEach(([alias,canonical])=>{
        if(alias.toLowerCase().includes(word)||word.includes(alias.toLowerCase())){
          canonical.toLowerCase().split(/\s+/).forEach(t=>expandedTerms.add(t));
        }
      });
    });
    const allTerms=[...expandedTerms];

    const sc=NX.nodes.filter(n=>!n.is_private).map(n=>{
      let s=0;
      const name=(n.name||'').toLowerCase();
      const notes=(n.notes||'').toLowerCase();
      const tags=(n.tags||[]).join(' ').toLowerCase();
      const cat=(n.category||'').toLowerCase();
      const nodeLoc=(notes.match(/suerte|este|toti|bar toti/gi)||[]).map(l=>l.toLowerCase());

      if(name===qLow)s+=100;
      else if(name.includes(qLow))s+=40;
      else if(qLow.includes(name)&&name.length>3)s+=30;

      allTerms.forEach(x=>{
        if(name.includes(x))s+=12;
        else if(tags.includes(x))s+=6;
        else if(cat.includes(x))s+=4;
        else if(notes.includes(x))s+=2;
      });

      // Location boost
      if(userLoc&&nodeLoc.includes(userLoc))s+=5;
      // Recency boost
      if(n.access_count>10)s+=2;else if(n.access_count>3)s+=1;
      // Time decay
      const sources=n.source_emails||[];
      if(sources.length){
        const newestDate=sources.reduce((max,src)=>{const d=new Date(src.date||0).getTime();return d>max?d:max;},0);
        const ageInDays=(now-newestDate)/86400000;
        if(ageInDays>180)s-=2;else if(ageInDays>90)s-=1;
      }
      return{node:n,score:s};
    }).filter(s=>s.score>0).sort((a,b)=>b.score-a.score);

    const rel=sc.slice(0,8).map(s=>s.node);
    const linkedIds=new Set();
    rel.slice(0,3).forEach(n=>{(n.links||[]).forEach(lid=>linkedIds.add(lid));});
    const linkedNodes=NX.nodes.filter(n=>linkedIds.has(n.id)&&!rel.find(r=>r.id===n.id)).slice(0,4);
    const allRelevant=[...rel,...linkedNodes];

    // ═══ PALACE NAVIGATION — walk communities for deeper context ═══
    let palaceCtx='';
    const hasCommunities=allRelevant.some(n=>n.community_id!=null);
    if(hasCommunities){
      // Find which communities the relevant nodes belong to
      const relComms=new Map();
      allRelevant.forEach(n=>{
        const cid=n.community_id;
        if(cid==null)return;
        if(!relComms.has(cid))relComms.set(cid,{nodes:[],label:n.community_label||'Zone '+cid});
        relComms.get(cid).nodes.push(n);
      });

      // For each relevant community, find bridge nodes that connect to other communities
      const bridgeContext=[];
      relComms.forEach((comm,cid)=>{
        const communityNodes=NX.nodes.filter(n=>n.community_id===cid&&!n.is_private);
        const bridges=communityNodes.filter(n=>n.community_role==='bridge');
        const godNode=communityNodes.find(n=>n.community_role==='god');

        // Walk bridges to find connected communities
        bridges.slice(0,3).forEach(b=>{
          const crossLinks=(b.links||[]).map(lid=>NX.nodes.find(nn=>nn.id===lid)).filter(nn=>nn&&nn.community_id!=null&&nn.community_id!==cid);
          crossLinks.slice(0,2).forEach(cl=>{
            bridgeContext.push(`${b.name} connects "${comm.label}" to "${cl.community_label||'Zone '+cl.community_id}" (via ${cl.name})`);
          });
        });

        // Add god node context if not already in allRelevant
        if(godNode&&!allRelevant.find(n=>n.id===godNode.id)){
          allRelevant.push(godNode);
        }
      });

      if(relComms.size>0){
        palaceCtx='\n\nMEMORY PALACE (community structure):\n';
        relComms.forEach((comm,cid)=>{
          const communityNodes=NX.nodes.filter(n=>n.community_id===cid&&!n.is_private);
          palaceCtx+=`Room "${comm.label}" (${communityNodes.length} items): ${communityNodes.slice(0,6).map(n=>n.name).join(', ')}${communityNodes.length>6?'...':''}\n`;
        });
        if(bridgeContext.length){
          palaceCtx+='Connections: '+bridgeContext.slice(0,4).join('; ')+'\n';
        }
      }

      // Deep dive: include adjacent communities too
      if(/deep dive|thorough|tell me everything|full picture/i.test(q)&&relComms.size>0){
        const adjacentComms=new Set();
        relComms.forEach((comm,cid)=>{
          const communityNodes=NX.nodes.filter(n=>n.community_id===cid);
          communityNodes.forEach(n=>{
            (n.links||[]).forEach(lid=>{
              const linked=NX.nodes.find(nn=>nn.id===lid);
              if(linked&&linked.community_id!=null&&!relComms.has(linked.community_id))adjacentComms.add(linked.community_id);
            });
          });
        });
        adjacentComms.forEach(adjCid=>{
          const adjNodes=NX.nodes.filter(n=>n.community_id===adjCid&&!n.is_private);
          const adjLabel=adjNodes[0]?.community_label||'Zone '+adjCid;
          palaceCtx+=`Adjacent room "${adjLabel}" (${adjNodes.length} items): ${adjNodes.slice(0,4).map(n=>n.name).join(', ')}\n`;
        });
      }
    }

    const det=allRelevant.map(n=>{
      let extras='';
      const sources=n.source_emails||[];
      if(sources.length){
        const newest=sources.reduce((max,src)=>{const d=src.date||'';return d>max?d:max;},'');
        if(newest)extras+=` [last updated: ${newest}]`;
      }
      const att=n.attachments;
      if(att&&att.length)extras+=` [Files: ${att.map(a=>a.filename||'file').join(', ')}]`;
      // Add confidence and role info
      if(n.community_role==='god')extras+=' [central node]';
      if(n.community_role==='bridge')extras+=' [bridge between zones]';
      const conf=n.link_confidence;
      if(conf&&Object.keys(conf).length){
        const extracted=Object.values(conf).filter(v=>v==='extracted').length;
        const total=Object.keys(conf).length;
        if(extracted>0)extras+=` [${extracted}/${total} verified links]`;
      }
      return`[${n.category}] ${n.name}: ${(n.notes||'').slice(0,500)}${extras}`;
    }).join('\n');

    const idx=NX.nodes.filter(n=>!n.is_private).map(n=>`${n.name} (${n.category})`).join(', ');

    const relIds=allRelevant.map(n=>n.id);
    NX.brain.state.activatedNodes=new Set(relIds);NX.brain.wakePhysics();
    setTimeout(()=>{NX.brain.state.activatedNodes=new Set();},12000);
    NX.trackAccess(rel.map(n=>n.id));

    const memory=await NX.fetchMemory(q);
    const ce=NX.brain.state.contractorEvents;
    let ev='';if(ce&&ce.length)ev='\n\nUPCOMING CONTRACTORS:\n'+ce.slice(0,8).map(e=>`${e.contractor_name} @ ${e.location||'?'} — ${e.event_date}${e.event_time?' '+e.event_time:''}`).join('\n');
    let tickets='';
    try{
      const{data:openTickets}=await NX.sb.from('tickets').select('title,location,status,created_at').eq('status','open').limit(5);
      if(openTickets&&openTickets.length)tickets='\n\nOPEN TICKETS:\n'+openTickets.map(t=>`\u2022 ${t.title}${t.location?' @ '+t.location:''} (${new Date(t.created_at).toLocaleDateString()})`).join('\n');
    }catch(e){}
    let cleanStatus='';
    try{
      const today=new Date().toISOString().split('T')[0];
      const{data:logs}=await NX.sb.from('daily_logs').select('entry').gte('created_at',today+'T00:00:00').limit(5);
      if(logs&&logs.length){
        const cleanLogs=logs.filter(l=>(l.entry||'').includes('Cleaning'));
        if(cleanLogs.length)cleanStatus="\n\nTODAY'S CLEANING:\n"+cleanLogs.map(l=>(l.entry||'').slice(0,100)).join('\n');
      }
    }catch(e){}
    return`RELEVANT NODES:\n${det}${palaceCtx}\n\nFULL INDEX (${NX.nodes.length} nodes):\n${idx}${memory}${ev}${tickets}${cleanStatus}`;
  }

  async function askAI(){
    const i=document.getElementById('chatInput'),q=i?.value?.trim();if(!q)return;
    i.value='';const sb=document.getElementById('chatSend');if(sb)sb.disabled=true;
    try{
    document.getElementById('brainWelcome').style.display='none';
    document.getElementById('brainExamples').style.display='none';
    document.getElementById('brainDim').classList.add('active');
    document.getElementById('chatHud').classList.add('expanded');
    document.getElementById('chatHud').classList.remove('collapsed');
    document.getElementById('resetBtn').style.display='';
    chatActive=true;addB(q,'user');chatHistory.push({role:'user',content:q});
    if(NX.syslog)NX.syslog('chat_ask',q.slice(0,80));
    showTyping();
    if(!NX.getApiKey()){hideTyping();addB(tt('noApiKey'),'ai');return;}
    const task=detectTask(q);
    if(task){
      if(task.type==='research'){try{await handleResearch(task.content);}catch(e){addB('Research error: '+e.message,'ai');}return;}
      if(task.type==='report'){try{await handleReport(task.content);}catch(e){addB('Report error: '+e.message,'ai');}return;}
      if(task.type==='createNode'){try{await handleCreateNode(task.content);}catch(e){addB('Node error: '+e.message,'ai');}return;}
      if(task.type==='sensitive'){await handleSensitiveScan();return;}
      if(task.type==='addClean'){await handleAddCleanTask(task.content);return;}
      if(task.type==='removeClean'){await handleRemoveCleanTask(task.content);return;}
      try{const result=await handleTask(task);if(result){addB(result,'ai');chatHistory.push({role:'assistant',content:result});if(voiceOn)speak(result);try{await NX.sb.from('chat_history').insert({question:q,answer:result,session_id:SESSION_ID,user_name:(NX.currentUser?NX.currentUser.name:'Unknown')});}catch(e){}return;}}catch(e){addB('Task error: '+e.message,'ai');return;}
    }
    const th=addB('🔍 '+tt('searching')+' '+NX.nodes.length+' '+tt('nodes')+'...','ai thinking');
    let sd=0;let searchDots=setInterval(()=>{sd=(sd+1)%4;th.textContent='🔍 '+tt('searching')+' '+NX.nodes.length+' '+tt('nodes')+'.'.repeat(sd);},400);
    try{
      const ctx=await getCtx(q);
      const msgs=chatHistory.slice(-6).map(m=>({role:m.role==='user'?'user':'assistant',content:m.content}));
      const ans=await NX.askClaude(getPERSONA()+'\n\n'+ctx,msgs,300,false);
      clearInterval(searchDots);
      // Parse confidence tag
      let confidence='';
      let cleanAns=(ans||'No response.').replace(/\[confidence:(high|medium|low)\]/i,(m,level)=>{confidence=level.toLowerCase();return '';}).trim();
      // Strip markdown formatting — no asterisks, bullets, headers, or symbols
      cleanAns=cleanAns
        .replace(/\*\*([^*]+)\*\*/g,'$1')   // **bold**
        .replace(/\*([^*]+)\*/g,'$1')        // *italic*
        .replace(/__([^_]+)__/g,'$1')        // __bold__
        .replace(/_([^_]+)_/g,'$1')          // _italic_
        .replace(/^#+\s*/gm,'')              // # headers
        .replace(/^[-•●▸▹►]\s*/gm,'')       // bullet points
        .replace(/^\d+\.\s+/gm,'')           // numbered lists
        .replace(/`([^`]+)`/g,'$1')          // `code`
        .replace(/```[\s\S]*?```/g,'')       // code blocks
        .replace(/\n{3,}/g,'\n\n')           // excessive newlines
        .trim();
      th.textContent=cleanAns;th.classList.remove('chat-thinking');
      // Confidence badge
      if(confidence){
        const badge=document.createElement('span');
        badge.className='chat-confidence chat-conf-'+confidence;
        badge.textContent=confidence==='high'?'●':confidence==='medium'?'◐':'○';
        badge.title=confidence+' confidence';
        th.appendChild(badge);
      }
      // Add timestamp
      const ts=document.createElement('span');ts.className='chat-time';ts.textContent=timeStr();th.appendChild(ts);
      // Auto-scroll to bottom
      requestAnimationFrame(()=>{const c=document.getElementById('chatMessages');c.scrollTop=c.scrollHeight;});
      chatHistory.push({role:'assistant',content:cleanAns});if(voiceOn)speak(cleanAns);
      // Low confidence — suggest research
      if(confidence==='low'){
        const words=q.split(/\s+/).filter(w=>w.length>2).slice(0,3).join(' ');
        addB(`💡 Low confidence. Try: "look up ${words}" for a web search.`,'ai');
      }
      // Auto-create nodes if AI response has substantial new info
      if(cleanAns.length>80&&confidence!=='low'){
        autoExtractNodes(q,cleanAns);
      }
      try{await NX.sb.from('chat_history').insert({question:q,answer:cleanAns,session_id:SESSION_ID,user_name:(NX.currentUser?NX.currentUser.name:'Unknown')});}catch(e){}
    }catch(e){clearInterval(searchDots);th.textContent='Error: '+(e.message||'Unknown');th.classList.remove('chat-thinking');}
    }catch(outerErr){hideTyping();addB('Error: '+(outerErr.message||'Chat failed'),'ai');console.error('askAI:',outerErr);}
  }

  function hideTyping(){document.querySelectorAll('.chat-typing').forEach(e=>e.remove());}

  function addB(t,type){
    // Remove any typing indicator
    document.querySelectorAll('.chat-typing').forEach(e=>e.remove());
    const el=document.createElement('div');
    el.className='chat-bubble chat-'+(type.includes('user')?'user':'ai');
    if(type.includes('thinking'))el.classList.add('chat-thinking');
    el.textContent=t;
    if(!type.includes('thinking')){
      const ts=document.createElement('span');ts.className='chat-time';ts.textContent=timeStr();el.appendChild(ts);
    }
    const c=document.getElementById('chatMessages');c.appendChild(el);
    requestAnimationFrame(()=>{c.scrollTop=c.scrollHeight;});
    return el;
  }

  function showTyping(){
    const c=document.getElementById('chatMessages');
    document.querySelectorAll('.chat-typing').forEach(e=>e.remove());
    const el=document.createElement('div');el.className='chat-typing';
    el.innerHTML='<span></span><span></span><span></span>';
    c.appendChild(el);
    requestAnimationFrame(()=>{c.scrollTop=c.scrollHeight;});
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
  const VOICES=[{id:'XB0fDUnXU5powFXDhCwa',name:'Charlotte'},{id:'EXAVITQu4vr4xnSDxMaL',name:'Bella'},{id:'jsCqWAovK2LkecY7zXl4',name:'Freya'},{id:'oWAxZDx7w5VEj9dCyTzz',name:'Grace'},{id:'21m00Tcm4TlvDq8ikWAM',name:'Rachel'},{id:'LcfcDJNUP1GQjkzn1xUU',name:'Emily'},{id:'jBpfuIE2acCO8z3wKNLl',name:'Gigi'},{id:'ErXwobaYiN019PkySvjV',name:'Antoni'},{id:'onwK4e9ZLuTAKqWW03F9',name:'Daniel'},{id:'TX3LPaxmHKxFdv7VOQHJ',name:'Liam'},{id:'TxGEqnHWrfWFTfGW9XjX',name:'Josh'},{id:'SOYHLrjzK2X1ezoPC6cr',name:'Harry'},{id:'ZQe5CZNOzWyzPSCn5a3c',name:'James'},{id:'pNInz6obpgDQGcFmaJgB',name:'Adam'},{id:'yoZ06aMxZJJ28mfd3POQ',name:'Sam'},{id:'ThT5KcBeYPX3keUQqHPh',name:'Dorothy'},{id:'VR6AewLTigWG4xSOukaG',name:'Arnold'},{id:'pqHfZKP75CvOlQylNhV4',name:'Bill'},{id:'AZnzlk1XvdvUeBnXmlld',name:'Domi'},{id:'D38z5RcWu1voky8WS1ja',name:'Fin'}];
  function getVoiceIdx(){return parseInt((NX.config&&NX.config.voice_idx!=null)?NX.config.voice_idx:(localStorage.getItem('nexus_voice_idx')||'0'))%VOICES.length;}
  let cvi=0;
  function setupVoice(){document.getElementById('micBtn').addEventListener('click',toggleMic);const vb=document.getElementById('voiceBtn');vb.classList.add('on');let pt=null;vb.addEventListener('click',()=>{voiceOn=!voiceOn;vb.classList.toggle('on',voiceOn);});vb.addEventListener('pointerdown',()=>{pt=setTimeout(()=>{cvi=(cvi+1)%VOICES.length;localStorage.setItem('nexus_voice_idx',cvi);voiceOn=true;vb.classList.add('on');speak(`${VOICES[cvi].name} here.`);pt=null;},600);});vb.addEventListener('pointerup',()=>{if(pt)clearTimeout(pt);});vb.addEventListener('pointerleave',()=>{if(pt)clearTimeout(pt);});if('speechSynthesis'in window){const pk=()=>{const v=speechSynthesis.getVoices();for(const n of['Samantha','Karen','Daniel','Microsoft Aria']){const f=v.find(x=>x.name.includes(n));if(f){pv=f;break;}}};pk();speechSynthesis.onvoiceschanged=pk;}}
  function toggleMic(){
    const b=document.getElementById('micBtn');
    if(recognition){recognition.stop();recognition=null;b.classList.remove('recording');return;}
    
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){
      // No speech API — try requesting mic permission first then retry
      if(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia){
        navigator.mediaDevices.getUserMedia({audio:true}).then(stream=>{
          stream.getTracks().forEach(t=>t.stop()); // Release mic
          // Permission granted — check again
          const SR2=window.SpeechRecognition||window.webkitSpeechRecognition;
          if(SR2){startRecognition(SR2,b);}
          else{addB('Voice input not supported in this app. Use the browser version for voice.','ai');}
        }).catch(()=>{
          addB('Microphone access denied. Check app permissions: Settings → Apps → NEXUS → Permissions → Microphone.','ai');
        });
      }else{
        addB('Voice input not available. Use the browser version for voice.','ai');
      }
      return;
    }
    startRecognition(SR,b);
  }
  
  function startRecognition(SR,b){
    recognition=new SR();
    recognition.continuous=false;
    recognition.interimResults=false;
    recognition.lang=NX.i18n?.getLang()==='es'?'es-US':'en-US';
    recognition.onresult=e=>{
      document.getElementById('chatInput').value=e.results[0][0].transcript;
      document.getElementById('chatSend').disabled=false;
      b.classList.remove('recording');
      recognition=null;
      askAI();
    };
    recognition.onerror=e=>{
      b.classList.remove('recording');
      recognition=null;
      if(e.error==='not-allowed'){
        addB('Microphone blocked. Check app permissions in phone Settings.','ai');
      }
    };
    recognition.onend=()=>{b.classList.remove('recording');recognition=null;};
    b.classList.add('recording');
    recognition.start();
  }
  let currentAudio=null;
  async function speak(text){cvi=getVoiceIdx();const ek=NX.getElevenLabsKey();if(ek){try{const r=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICES[cvi].id}`,{method:'POST',headers:{'Content-Type':'application/json','xi-api-key':ek},body:JSON.stringify({text:text.slice(0,800),model_id:'eleven_turbo_v2',voice_settings:{stability:.35,similarity_boost:.82,style:.45,use_speaker_boost:true}})});if(r.ok){const bl=await r.blob(),u=URL.createObjectURL(bl);if(currentAudio){currentAudio.pause();currentAudio=null;}const a=new Audio(u);a.playbackRate=1.25;currentAudio=a;a.play();a.onended=()=>{URL.revokeObjectURL(u);currentAudio=null;};return;}}catch(e){}}if(!('speechSynthesis'in window))return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text.slice(0,600));if(pv)u.voice=pv;u.rate=1.3;speechSynthesis.speak(u);}
  function stopSpeaking(){if(currentAudio){currentAudio.pause();currentAudio=null;}if('speechSynthesis'in window)speechSynthesis.cancel();}

  // Camera — scan receipt/document directly from chat
  function setupCamera(){
    const camBtn=document.getElementById('camBtn');
    if(!camBtn)return;
    camBtn.addEventListener('click',async()=>{
      // Expand chat if collapsed
      const hud=document.getElementById('chatHud');
      if(!hud.classList.contains('expanded')){
        hud.classList.add('expanded');
        document.getElementById('brainDim')?.classList.add('active');
      }
      // Use native camera or file input
      try{
        const result=await NX.scanReceipt();
        if(result){
          // Show what was scanned
          const summary=result.vendor?`Scanned: ${result.vendor}${result.amount?' — $'+result.amount:''}${result.date?' ('+result.date+')':''}`:
            result.text?'Scanned document: '+result.text.slice(0,100)+'...':'Scan complete';
          addB(summary,'user');
          chatHistory.push({role:'user',content:'I just scanned this: '+JSON.stringify(result)});
          // Ask AI to process it
          showTyping();
          const ctx=await getCtx('process scanned document');
          const ans=await NX.askClaude(getPERSONA()+'\n\n'+ctx,[
            ...chatHistory.slice(-4),
            {role:'user',content:'I just scanned this document/receipt. Tell me what it is and if I should save it as a node. Here is the data: '+JSON.stringify(result)}
          ],800,false);
          hideTyping();
          let cleanAns=(ans||'').replace(/\[confidence:(high|medium|low)\]/i,'').replace(/\*\*([^*]+)\*\*/g,'$1').replace(/\*([^*]+)\*/g,'$1').replace(/^#+\s*/gm,'').replace(/^[-•]\s*/gm,'').trim();
          addB(cleanAns||'Got the scan. What do you want to do with it?','ai');
          chatHistory.push({role:'assistant',content:cleanAns});
          if(voiceOn)speak(cleanAns);
        }
      }catch(e){
        addB('Camera not available. Try from the NEXUS app.','ai');
      }
    });
  }

  // Auto-extract nodes silently from AI responses
  async function autoExtractNodes(question,answer){
    try{
      const existing=NX.nodes.map(n=>n.name.toLowerCase());
      const result=await NX.askClaude(
        `You check if this AI response contains NEW knowledge worth saving for restaurant ops (Suerte, Este, Bar Toti).
Only extract if there's concrete, factual info — names, specs, contacts, procedures.
Do NOT extract vague statements, opinions, or info already in this list: ${existing.slice(0,100).join(', ')}
If nothing new: return {"nodes":[]}
If new info: return {"nodes":[{"name":"...","category":"equipment|contractors|vendors|procedure|projects|people|systems|parts|location","tags":["..."],"notes":"..."}]}
Return ONLY JSON.`,
        [{role:'user',content:`Q: ${question}\nA: ${answer}`}],400);
      let json=result.replace(/```json\s*/gi,'').replace(/```\s*/g,'');
      const s=json.indexOf('{'),e=json.lastIndexOf('}');
      if(s===-1||e<=s)return;
      json=json.slice(s,e+1);const parsed=JSON.parse(json);
      if(!parsed.nodes||!parsed.nodes.length)return;
      const vc=['equipment','contractors','vendors','procedure','projects','people','systems','parts','location'];
      let created=0;
      for(const n of parsed.nodes){
        const nm=(n.name||'').trim();if(!nm||nm.length<2)continue;
        if(existing.includes(nm.toLowerCase()))continue;
        const{error}=await NX.sb.from('nodes').insert({
          name:nm.slice(0,200),category:vc.includes(n.category)?n.category:'people',
          tags:Array.isArray(n.tags)?n.tags.slice(0,10):[],notes:(n.notes||'').slice(0,2000),
          links:[],access_count:1,source_emails:[{from:'Auto-extract',subject:question.slice(0,100),date:new Date().toISOString().split('T')[0]}]
        });
        if(!error){created++;existing.push(nm.toLowerCase());}
      }
      if(created){await NX.loadNodes();addB(`💾 Auto-saved ${created} node${created>1?'s':''} from this conversation.`,'ai');}
    }catch(e){}
  }

  NX.brain.initChat=setupChat;
  NX.brain.stopSpeaking=stopSpeaking;
})();
