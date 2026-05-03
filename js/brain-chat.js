/* NEXUS Brain Chat v10 — Deep reasoning, glossary, location context, temporal awareness */
(function(){
  if(!localStorage.getItem('nexus_session_id'))localStorage.setItem('nexus_session_id',crypto.randomUUID?crypto.randomUUID():'s_'+Date.now()+'_'+Math.random().toString(36).slice(2));
  const SESSION_ID=localStorage.getItem('nexus_session_id');
  let chatHistory=[],voiceOn=true,recognition=null,chatActive=false;
  function tt(k){return NX.i18n?NX.i18n.t(k):k;}

  // ═══ SELF-OPTIMIZATION (Layer 6) — Meta-signal tracking ═══
  let lastAIResponse='',lastUserQuery='',consecutiveFollowUps=0;

  // ═══ BOARD/LIST RESOLVER ════════════════════════════════════════════
  // Chat creates cards on behalf of the user but doesn't know which
  // board is "active" (chat is global, board view may not be open).
  // Pick the first non-archived board, prefer a list named report/
  // todo/triage. Without this, cards get created with no board_id +
  // no list_id and become orphans — invisible on every board view.
  async function resolveBoardAndList(){
    try{
      const { data: bs } = await NX.sb.from('boards')
        .select('id').eq('archived', false).order('position').limit(1);
      if(!bs?.length) return null;
      const boardId = bs[0].id;
      const { data: ls } = await NX.sb.from('board_lists')
        .select('*').eq('board_id', boardId).order('position');
      const target = (ls||[]).find(l => /report|todo|triage/i.test(l.name)) || (ls||[])[0];
      if(!target) return null;
      return { boardId, listId: target.id };
    }catch(e){
      console.warn('[brain-chat] resolveBoardAndList:', e);
      return null;
    }
  }

  async function logMeta(signalType, data){
    try{
      await NX.sb.from('meta_signals').insert({signal_type:signalType,signal_data:data});
    }catch(e){}
  }

  function trackChatQuality(query, response, confidence){
    // Detect follow-up (user asking again = previous answer was insufficient)
    const isFollowUp=/^(what|but|no|wait|actually|I mean|that's not|can you|more|elaborate|explain)/i.test(query);
    if(isFollowUp&&lastAIResponse){
      consecutiveFollowUps++;
      logMeta('chat_quality',{type:'follow_up',count:consecutiveFollowUps,prev_query:lastUserQuery?.slice(0,100),query:query.slice(0,100),confidence});
    }else{
      if(lastUserQuery&&consecutiveFollowUps===0){
        // User moved on without follow-up = good answer
        logMeta('chat_quality',{type:'satisfied',query:lastUserQuery?.slice(0,100),confidence});
      }
      consecutiveFollowUps=0;
    }
    lastUserQuery=query;lastAIResponse=response;
  }

  function trackNodeAccess(nodeId, nodeName, source){
    logMeta('node_access',{node_id:nodeId,name:nodeName?.slice(0,50),source});
  }

  const PERSONA_BASE=`You are NEXUS — a personal intelligence system. Calm, warm, a little dry. Not bubbly, not excited. Chill confidence — you know your stuff and you don't need to prove it.

HOW YOU TALK:
- Calm and short. 1-2 sentences max for simple questions. 3 tops for complex stuff.
- Warm but never over-the-top. A casual "nice" or "got it" is fine. Never multiple exclamation marks.
- Never use asterisks, bold, bullets, numbered lists, or markdown. Plain text only.
- Never start with "Great question" or "I'd be happy to" or "Absolutely!" — just answer.
- Use contractions. Keep it natural.
- Never say "based on my data" or "according to my records." You just know.
- Be brief. If the answer is one sentence, give one sentence. Don't pad.

YOUR ROLE:
- You're a personal intelligence system. You store knowledge, find connections, predict patterns, and keep things organized.
- You learn from every piece of information fed to you — emails, notes, conversations — and build a knowledge graph of how things connect.
- Proactively mention upcoming deadlines, scheduled events, expiring items, and predicted patterns.
- When asked about people, places, equipment, or projects, trace connections through the knowledge graph.
- If something needs attention, flag it with a little urgency but keep it light.

KNOWLEDGE RULES:
- If info is older than 60 days, mention it casually: "last I heard back in March, might wanna double check that"
- If two sources disagree, mention both and which is newer
- Never make up phone numbers, prices, part numbers, or dates
- Include specific details (model numbers, account numbers, addresses) when you have them
- When MEMORY PALACE data is available, follow connections between zones — don't just answer from one zone, trace how things connect
- Mention bridge connections when they add useful context: "that vendor also connects to your equipment through..."
- If a node is marked [central node], it's the most important entity in its zone
- If a node is marked [bridge between zones], it connects different areas of knowledge
- Verified links (extracted) are more reliable than inferred ones
- "deep dive" means walk the full palace — explore every connected zone and bridge

INTELLIGENCE SYSTEMS (use these proactively):
- PREDICTED PATTERNS: You can see recurring patterns. If relevant, mention naturally: "that usually happens every 6 weeks, so the next one should be around May 20"
- COMMUNITY INTELLIGENCE: When you see community summaries, use them for connected answers. Tell the story of how things relate, don't just list facts
- TODAY'S BRIEF: If a morning brief is in your context, reference it when relevant
- COMPOUND ACTIONS: When someone reports a problem, think about ALL actions needed. Offer to create a ticket, look up the right contact, add a task
- STALENESS: If the data is old (check dates), say so. "I have info from February but things might have changed"

CONFIDENCE:
- End every response with: [confidence:high] [confidence:medium] or [confidence:low]

COMMANDS (mention when relevant):
- "look up [topic]" for web search
- "remember [name] - [details]" to save knowledge
- "log that [text]" for daily log
- "report [issue]" for ticket
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
- Use terminology that matches the knowledge in your nodes naturally
- Bilingual — if they switch to Spanish, switch with them
- Late night questions get shorter, softer answers
- If they say "deep dive" go thorough
- Never say "I understand your concern" or "that's a great point" — just get to it`;
    }

    if(lang==='es')persona+='\n\nRespond ONLY in Spanish.';
    // Chat-view persona sheet tone override — set when user picks a tone
    // in the chat Tone & voice sheet. Empty string for default tone.
    const toneSuffix = window._NX_PERSONA_SUFFIX || '';
    if (toneSuffix) persona += toneSuffix;
    // Per-voice persona prefix — when the active voice carries a
    // systemPrefix (e.g. Providentia: "You are Providentia, goddess of
    // foresight…"), prepend it so it sets the tone before the rest of
    // NEXUS's instructions. This is what makes a custom voice feel
    // like a different *agent*, not just a different timbre.
    try{
      const v = NX.getVoiceMeta && NX.getVoiceMeta(getVoiceIdx());
      if(v && v.systemPrefix){
        persona = v.systemPrefix + '\n\n' + persona;
      }
    }catch(_){}
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

  // ═══ COMPOUND INTENT DETECTION (Layer 5 — Agentic Actions) ═══
  const COMPOUND_RX=[
    /(?:broken|not working|running warm|running hot|leaking|down|malfunction|stopped)/i,
    /(?:schedule|set up|arrange|book)\s+(?:a\s+)?(?:visit|appointment|service|repair)/i,
    /(?:prepare|get ready|prep)\s+(?:for|before)\s+(?:inspection|health|audit|visit)/i,
    /(?:follow up|check on|what happened|status of|update on)\s+/i,
  ];
  function detectCompound(q){return COMPOUND_RX.some(rx=>rx.test(q));}

  async function handleCompoundAction(q,aiResponse){
    // Ask Claude to detect actionable intents from the conversation
    try{
      const result=await NX.askClaude(
        'Analyze this restaurant operations message and AI response. Identify specific actions that should be taken. Return ONLY JSON: {"actions":[{"type":"ticket|card|log|schedule","title":"short title","detail":"specifics","urgency":"high|normal|low"}]} Return empty array if no actions needed. Max 3 actions.',
        [{role:'user',content:`USER: ${q}\nAI RESPONSE: ${aiResponse}`}],400);
      let json=result.replace(/```json\s*/gi,'').replace(/```\s*/g,'');
      const s=json.indexOf('{'),e=json.lastIndexOf('}');
      if(s===-1||e<=s)return;
      json=json.slice(s,e+1);
      const parsed=JSON.parse(json);
      if(!parsed.actions||!parsed.actions.length)return;

      // Present action suggestions as buttons
      const actionsDiv=document.createElement('div');
      actionsDiv.className='chat-actions';
      const chainLog=[];

      for(const action of parsed.actions.slice(0,3)){
        const btn=document.createElement('button');
        btn.className='chat-action-btn';
        const icon=action.type==='ticket'?'⚠':action.type==='card'?'☑':action.type==='schedule'?'📅':'📝';
        btn.textContent=`${icon} ${action.type}: ${action.title}`;
        btn.addEventListener('click',async()=>{
          btn.disabled=true;btn.textContent+=' ✓';
          try{
            if(action.type==='ticket'){
              const ticketData={title:action.title,notes:action.detail,status:'open',priority:action.urgency==='high'?'urgent':'normal',reported_by:NX.currentUser?.name||'AI'};
              await NX.sb.from('tickets').insert(ticketData);
              if (NX.notifyTicketCreated) NX.notifyTicketCreated(ticketData);
              chainLog.push({type:'ticket',title:action.title,result:'created'});
            }else if(action.type==='card'){
              // Resolve a board + list so the card is visible on the
              // board (not orphaned). Picks the first non-archived
              // board and prefers a list named report/todo/triage.
              // Without these the card is created with no list_id and
              // never appears anywhere — silent data loss.
              const target=await resolveBoardAndList();
              if(!target){
                NX.toast('Could not find a board to add this card to','error');
                return;
              }
              const cardRow={
                title:action.title,
                board_id:target.boardId,
                list_id:target.listId,
                column_name:'',
                position:999,
                priority:action.urgency,
                reported_by:NX.currentUser?.name||null,
                checklist:[], comments:[], labels:[], photo_urls:[],
                archived:false,
              };
              await NX.sb.from('kanban_cards').insert(cardRow);
              if (NX.notifyCardCreated) NX.notifyCardCreated(cardRow);
              chainLog.push({type:'card',title:action.title,result:'created'});
            }else if(action.type==='log'){
              await NX.sb.from('daily_logs').insert({entry:action.title+' — '+action.detail});
              chainLog.push({type:'log',title:action.title,result:'logged'});
            }else if(action.type==='schedule'){
              // Look up contractor from brain
              const contractor=NX.nodes.find(n=>n.category==='contractors'&&(n.name||'').toLowerCase().includes((action.detail||'').toLowerCase().split(' ')[0]));
              if(contractor){
                const tomorrow=new Date(Date.now()+86400000).toISOString().split('T')[0];
                await NX.sb.from('contractor_events').insert({contractor_name:contractor.name,event_date:tomorrow,description:action.title,status:'pending'});
                chainLog.push({type:'schedule',title:contractor.name,result:'event created'});
              }else{
                const target=await resolveBoardAndList();
                if(!target){
                  chainLog.push({type:'card',title:'Schedule: '+action.title,result:'no board found'});
                  return;
                }
                const schedCard={
                  title:'Schedule: '+action.title,
                  board_id:target.boardId,
                  list_id:target.listId,
                  column_name:'',
                  position:999,
                  reported_by:NX.currentUser?.name||null,
                  checklist:[], comments:[], labels:[], photo_urls:[],
                  archived:false,
                };
                await NX.sb.from('kanban_cards').insert(schedCard);
                if (NX.notifyCardCreated) NX.notifyCardCreated(schedCard);
                chainLog.push({type:'card',title:'Schedule: '+action.title,result:'card created (no contractor found)'});
              }
            }
            NX.toast(`${action.type}: ${action.title} ✓`,'success');
          }catch(err){NX.toast('Failed: '+err.message,'error');}
        });
        actionsDiv.appendChild(btn);
      }

      // Add to chat
      const msgEl=document.createElement('div');
      msgEl.className='chat-bubble chat-ai';
      msgEl.textContent='Actions I can take:';
      msgEl.appendChild(actionsDiv);
      document.getElementById('chatMessages').appendChild(msgEl);
      requestAnimationFrame(()=>{const c=document.getElementById('chatMessages');c.scrollTop=c.scrollHeight;});

      // Log the action chain
      if(chainLog.length){
        try{
          await NX.sb.from('action_chains').insert({trigger_text:q.slice(0,200),actions:chainLog,user_name:NX.currentUser?.name||'Unknown'});
        }catch(e){}
      }
    }catch(e){console.log('Compound action detection failed:',e);}
  }
  async function handleTask(task){
    if(task.type==='log'){const{error}=await NX.sb.from('daily_logs').insert({entry:task.content});return error?'Failed to log.':`Logged: "${task.content}"`;}
    if(task.type==='card'){
      const target=await resolveBoardAndList();
      if(!target) return 'Could not find a board to add this card to.';
      const cardRow={
        title:task.content,
        board_id:target.boardId,
        list_id:target.listId,
        column_name:'',
        position:999,
        reported_by:NX.currentUser?.name||null,
        checklist:[], comments:[], labels:[], photo_urls:[],
        archived:false,
      };
      const{error}=await NX.sb.from('kanban_cards').insert(cardRow);
      if (!error && NX.notifyCardCreated) NX.notifyCardCreated(cardRow);
      return error?'Failed.':`Card created: "${task.content}"`;
    }
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
        const ticketData={
          title:notes.slice(0,100),notes,location:userLoc,
          reported_by:userName,status:'open',priority,
          photo_url:photoUrl,ai_troubleshoot:troubleshoot
        };
        const{error}=await NX.sb.from('tickets').insert(ticketData);
        if(!error){
          submitBtn.textContent='✓';
          form.querySelector('#ticketStatus').textContent=lang==='es'?'✓ Ticket creado':'✓ Ticket submitted';
          form.querySelector('#ticketStatus').style.color='#39ff14';
          addB(lang==='es'?`✓ Ticket registrado: "${notes.slice(0,60)}"`:`✓ Ticket logged: "${notes.slice(0,60)}"`,'ai');
          // Fire push to managers — fire and forget
          if (NX.notifyTicketCreated) NX.notifyTicketCreated(ticketData);
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

  // ═══════════════════════════════════════════════════════════════
  // REASONING ENGINE — Tier 1: Query Decomposition + Tier 2: ReAct
  // ═══════════════════════════════════════════════════════════════

  // Detect if a question is "complex" enough to warrant decomposition
  function isComplex(q){
    if(q.split(/\s+/).length<4)return false; // Too short to decompose
    // Multi-entity: mentions multiple categories or asks about relationships
    const complexSignals=[
      /\b(and|versus|vs|compared|between|relationship|connect|relate)\b/i,
      /\b(ready|prepare|status|overview|situation|everything|full picture)\b/i,
      /\b(should|recommend|decide|compare|which|best|option)\b/i,
      /\b(history|timeline|over time|pattern|trend|usually|always)\b/i,
      /\b(all|every|complete|whole|across|both)\b/i,
      /\?.*\?/, // Multiple question marks
      /\b(who|what|when|where|why|how)\b.*\b(who|what|when|where|why|how)\b/i, // Multiple W-questions
    ];
    return complexSignals.some(rx=>rx.test(q));
  }

  // TIER 1: Decompose a complex question into sub-questions
  async function decomposeQuery(q){
    try{
      const resp=await NX.askClaude(
        'You decompose complex questions into simpler sub-questions for a knowledge graph search. Return ONLY a JSON array of 2-4 short sub-questions. Each sub-question should target a different aspect of the original question. No explanation, no markdown. Example: ["Who services the walk-in?","Are there open tickets for the walk-in?","When was the last maintenance visit?"]',
        [{role:'user',content:q}],
        150
      );
      let clean=resp.replace(/```json|```/g,'').trim();
      const s=clean.indexOf('['),e=clean.lastIndexOf(']');
      if(s===-1||e<=s)return[q];
      const parsed=JSON.parse(clean.slice(s,e+1));
      if(Array.isArray(parsed)&&parsed.length>=2)return parsed.slice(0,4);
      return[q];
    }catch(e){
      console.warn('[Reasoning] Decomposition failed:',e);
      return[q];
    }
  }

  // Enhanced getCtx that can merge results from multiple sub-queries
  async function getCtxMulti(subQueries){
    const seenIds=new Set();
    const allNodes=[];
    const allLinked=[];

    for(const sq of subQueries){
      // Run scoring for each sub-query
      const w=sq.toLowerCase().split(/\s+/).filter(x=>x.length>2);
      const sqLow=sq.toLowerCase();
      const aliases=NX._aliases||{};
      const now=Date.now();

      const expandedTerms=new Set(w);
      w.forEach(word=>{
        Object.entries(aliases).forEach(([alias,canonical])=>{
          if(alias.toLowerCase().includes(word)||word.includes(alias.toLowerCase())){
            canonical.toLowerCase().split(/\s+/).forEach(t=>expandedTerms.add(t));
          }
        });
      });
      const allTerms=[...expandedTerms];

      const scored=NX.nodes.filter(n=>!n.is_private).map(n=>{
        let s=0;
        const name=(n.name||'').toLowerCase();
        const notes=(n.notes||'').toLowerCase();
        const tags=(n.tags||[]).join(' ').toLowerCase();
        const cat=(n.category||'').toLowerCase();

        if(name===sqLow)s+=100;
        else if(name.includes(sqLow))s+=40;
        else if(sqLow.includes(name)&&name.length>3)s+=30;

        allTerms.forEach(x=>{
          if(name.includes(x))s+=12;
          else if(tags.includes(x))s+=6;
          else if(cat.includes(x))s+=4;
          else if(notes.includes(x))s+=2;
        });

        // Temporal decay
        const relDate=n.last_relevant_date||null;
        const sources=n.source_emails||[];
        let newestMs=0;
        if(relDate)newestMs=new Date(relDate).getTime();
        else if(sources.length){newestMs=sources.reduce((max,src)=>{const d=new Date(src.date||0).getTime();return d>max?d:max;},0);}
        if(newestMs>0){
          const ageInDays=(now-newestMs)/86400000;
          if(ageInDays<14)s+=4;else if(ageInDays<30)s+=2;else if(ageInDays>90)s-=Math.min(4,Math.floor((ageInDays-90)/60));
        }
        if(n.community_role==='god')s+=3;
        if(n.community_role==='bridge')s+=2;
        return{node:n,score:s};
      }).filter(s=>s.score>0).sort((a,b)=>b.score-a.score);

      // Take top results, skip already-seen nodes
      scored.slice(0,6).forEach(s=>{
        if(!seenIds.has(s.node.id)){
          seenIds.add(s.node.id);
          allNodes.push(s.node);
        }
      });
    }

    // Multi-hop from collected nodes (same as getCtx)
    const hopNodes=[];
    allNodes.slice(0,6).forEach(n=>{
      const conf=n.link_confidence||{};
      (n.links||[]).forEach(lid=>{
        if(seenIds.has(lid))return;
        const linked=NX.nodes.find(nn=>nn.id===lid);
        if(!linked||linked.is_private)return;
        seenIds.add(lid);
        hopNodes.push(linked);
      });
    });

    return[...allNodes,...hopNodes.slice(0,6)];
  }

  // ═══ TIER 2: ReAct — Graph Tools the AI can call ═══
  const GRAPH_TOOLS=[
    {name:'search_nodes',description:'Search the knowledge graph for nodes matching a query. Returns name, category, notes, and links.',params:{query:'string'}},
    {name:'get_node_detail',description:'Get full details of a specific node by name (exact or partial match).',params:{name:'string'}},
    {name:'check_patterns',description:'Check for predicted recurring patterns for an entity.',params:{entity:'string'}},
    {name:'count_tickets',description:'Count open tickets, optionally filtered by location.',params:{status:'string',location:'string (optional)'}},
    {name:'get_recent_events',description:'Get contractor events from the last N days.',params:{days:'number'}},
    {name:'get_community',description:'Get the community summary and members for a node.',params:{node_name:'string'}},
    {name:'reverse_lookup',description:'Find all nodes that link TO a given node (who references it?).',params:{node_name:'string'}},
    {name:'get_pending_pm_logs',description:'Check for service logs submitted via QR scan that are awaiting admin review. Use when asked about pending reviews, unreviewed service submissions, or new PM entries.',params:{}},
    {name:'list_equipment_by_status',description:'List equipment filtered by operational status. Use when asked what is down, what needs service, what is retired. Status options: operational, needs_service, down, retired.',params:{status:'string',location:'string (optional)'}},
    {name:'get_upcoming_deadlines',description:'Unified view of everything due in the next N days — kanban cards with due dates, contractor events, equipment warranty expirations, and upcoming PMs. Use when asked about upcoming schedule, deadlines, next week, what is coming up.',params:{days:'number'}},
  ];

  // Execute a graph tool call against real data
  async function executeGraphTool(toolName,params){
    try{
      switch(toolName){
        case 'search_nodes':{
          const q=(params.query||'').toLowerCase();
          const results=NX.nodes.filter(n=>!n.is_private&&(
            (n.name||'').toLowerCase().includes(q)||
            (n.notes||'').toLowerCase().includes(q)||
            (n.tags||[]).some(t=>t.toLowerCase().includes(q))||
            (n.category||'').toLowerCase().includes(q)
          )).slice(0,8);
          return results.map(n=>`[${n.category}] ${n.name}: ${(n.notes||'').slice(0,120)} (links: ${(n.links||[]).length}, role: ${n.community_role||'peripheral'})`).join('\n')||'No nodes found matching "'+params.query+'"';
        }
        case 'get_node_detail':{
          const q=(params.name||'').toLowerCase();
          const node=NX.nodes.find(n=>(n.name||'').toLowerCase()===q)||
                     NX.nodes.find(n=>(n.name||'').toLowerCase().includes(q));
          if(!node)return'Node not found: "'+params.name+'"';
          const linked=(node.links||[]).map(lid=>{const ln=NX.nodes.find(n=>n.id===lid);return ln?ln.name:null;}).filter(Boolean);
          const age=node.last_relevant_date?Math.floor((Date.now()-new Date(node.last_relevant_date).getTime())/86400000)+'d ago':'unknown age';
          return`${node.name} (${node.category})\nNotes: ${node.notes||'none'}\nTags: ${(node.tags||[]).join(', ')}\nLinks to: ${linked.join(', ')||'none'}\nCommunity: ${node.community_label||'none'} (role: ${node.community_role||'peripheral'})\nData age: ${age}`;
        }
        case 'check_patterns':{
          const entity=(params.entity||'').toLowerCase();
          const{data}=await NX.sb.from('patterns').select('*').eq('active',true);
          const matches=(data||[]).filter(p=>(p.entity_name||'').toLowerCase().includes(entity));
          if(!matches.length)return'No patterns found for "'+params.entity+'"';
          return matches.map(p=>`${p.entity_name}: ${p.pattern_type}, every ~${p.interval_days} days, next predicted: ${p.next_predicted}, confidence: ${Math.round(p.confidence*100)}%`).join('\n');
        }
        case 'count_tickets':{
          let query=NX.sb.from('tickets').select('title,status,location,created_at');
          if(params.status)query=query.eq('status',params.status);
          if(params.location)query=query.ilike('location','%'+params.location+'%');
          const{data}=await query.limit(20);
          if(!data||!data.length)return'No tickets found';
          return`${data.length} ticket(s):\n`+data.map(t=>{
            const age=Math.floor((Date.now()-new Date(t.created_at).getTime())/86400000);
            return`- ${t.title} [${t.status}] @ ${t.location||'?'} (${age}d old)`;
          }).join('\n');
        }
        case 'get_recent_events':{
          const days=parseInt(params.days)||14;
          const since=new Date(Date.now()-days*86400000).toISOString().split('T')[0];
          const{data}=await NX.sb.from('contractor_events').select('*').gte('event_date',since).order('event_date',{ascending:false}).limit(15);
          if(!data||!data.length)return'No contractor events in the last '+days+' days';
          return data.map(e=>`${e.event_date}: ${e.contractor_name} @ ${e.location||'?'} — ${(e.description||'').slice(0,80)} [${e.status||'pending'}]`).join('\n');
        }
        case 'get_community':{
          const q=(params.node_name||'').toLowerCase();
          const node=NX.nodes.find(n=>(n.name||'').toLowerCase().includes(q));
          if(!node||!node.community_id)return'No community found for "'+params.node_name+'"';
          const{data:comm}=await NX.sb.from('communities').select('*').eq('community_id',node.community_id).single();
          const members=NX.nodes.filter(n=>n.community_id===node.community_id).slice(0,10);
          let result=`Community: ${comm?.label||'Zone '+node.community_id}\nSummary: ${comm?.summary||'no summary yet'}\nMembers (${members.length}): ${members.map(m=>m.name).join(', ')}`;
          if(comm?.bridge_node_ids?.length){
            const bridges=NX.nodes.filter(n=>comm.bridge_node_ids.includes(String(n.id)));
            result+=`\nBridges to other zones: ${bridges.map(b=>b.name).join(', ')}`;
          }
          return result;
        }
        case 'reverse_lookup':{
          const q=(params.node_name||'').toLowerCase();
          const target=NX.nodes.find(n=>(n.name||'').toLowerCase().includes(q));
          if(!target)return'Node not found: "'+params.node_name+'"';
          const referrers=NX.nodes.filter(n=>n.links&&n.links.includes(target.id));
          if(!referrers.length)return'No nodes link to "'+target.name+'"';
          return`${referrers.length} node(s) reference ${target.name}:\n`+referrers.map(r=>`- ${r.name} (${r.category})`).join('\n');
        }
        case 'get_pending_pm_logs':{
          // Service logs submitted via QR scan that await admin review.
          // These live in pm_logs with review_status='pending'.
          const{data,error}=await NX.sb.from('pm_logs')
            .select('id,contractor_name,contractor_company,service_date,service_type,work_performed,equipment_id,submitted_at,flagged_spam')
            .eq('review_status','pending')
            .order('submitted_at',{ascending:false})
            .limit(10);
          if(error)return'Could not load pending PM logs: '+error.message;
          if(!data||!data.length)return'No pending service logs awaiting review.';
          // Join each log to its equipment name for context
          const eqIds=[...new Set(data.map(l=>l.equipment_id).filter(Boolean))];
          const{data:eqs}=await NX.sb.from('equipment').select('id,name,location').in('id',eqIds);
          const eqMap=Object.fromEntries((eqs||[]).map(e=>[e.id,e]));
          const lines=data.map(l=>{
            const eq=eqMap[l.equipment_id];
            const eqStr=eq?`${eq.name} at ${eq.location}`:'unknown equipment';
            const spam=l.flagged_spam?' [SPAM FLAGGED]':'';
            return`- ${l.service_type||'service'} on ${eqStr} by ${l.contractor_name||'anonymous'}${l.contractor_company?' ('+l.contractor_company+')':''} on ${l.service_date}${spam}: ${(l.work_performed||'').slice(0,80)}`;
          });
          return`${data.length} pending service log${data.length===1?'':'s'} awaiting admin review:\n`+lines.join('\n');
        }
        case 'list_equipment_by_status':{
          const status=(params.status||'').toLowerCase();
          const validStatuses=['operational','needs_service','down','retired'];
          if(!validStatuses.includes(status))return'Invalid status. Use: operational, needs_service, down, or retired.';
          let q=NX.sb.from('equipment').select('id,name,location,status,category,next_pm_date').eq('status',status);
          if(params.location)q=q.ilike('location','%'+params.location+'%');
          const{data,error}=await q.limit(30);
          if(error)return'Could not list equipment: '+error.message;
          if(!data||!data.length)return`No equipment with status "${status}".`;
          return`${data.length} equipment with status "${status}":\n`+data.map(e=>`- ${e.name} (${e.category||'—'}) at ${e.location||'—'}${e.next_pm_date?', next PM '+e.next_pm_date:''}`).join('\n');
        }
        case 'get_upcoming_deadlines':{
          // Unified look at everything due soon. Pulls 4 sources.
          const days=Math.max(1,Math.min(90,parseInt(params.days,10)||7));
          const todayIso=new Date().toISOString().slice(0,10);
          const futureIso=new Date(Date.now()+days*86400000).toISOString().slice(0,10);
          const[cards,events,warranties,pms]=await Promise.all([
            NX.sb.from('kanban_cards').select('title,due_date,priority,location,column_name').not('due_date','is',null).gte('due_date',todayIso).lte('due_date',futureIso).or('archived.is.null,archived.eq.false').neq('column_name','done').limit(20),
            NX.sb.from('contractor_events').select('contractor_name,event_date,event_time,description,location').gte('event_date',todayIso).lte('event_date',futureIso).neq('status','cancelled').order('event_date').limit(10),
            NX.sb.from('equipment').select('name,warranty_until,location').not('warranty_until','is',null).gte('warranty_until',todayIso).lte('warranty_until',futureIso).limit(10),
            NX.sb.from('equipment').select('name,next_pm_date,location').not('next_pm_date','is',null).gte('next_pm_date',todayIso).lte('next_pm_date',futureIso).limit(10),
          ]);
          const items=[];
          (cards.data||[]).forEach(c=>items.push({d:c.due_date,t:`Card: ${c.title}${c.priority&&c.priority!=='normal'?' ['+c.priority.toUpperCase()+']':''} at ${c.location||'—'}`}));
          (events.data||[]).forEach(e=>items.push({d:e.event_date,t:`Visit: ${e.contractor_name||'Contractor'}${e.location?' at '+e.location:''}${e.description?' — '+e.description:''}`}));
          (warranties.data||[]).forEach(w=>items.push({d:w.warranty_until,t:`Warranty expires: ${w.name} (${w.location||'—'})`}));
          (pms.data||[]).forEach(p=>items.push({d:p.next_pm_date,t:`PM due: ${p.name} (${p.location||'—'})`}));
          if(!items.length)return`Nothing scheduled for the next ${days} days.`;
          items.sort((a,b)=>(a.d||'').localeCompare(b.d||''));
          return`${items.length} item(s) upcoming in next ${days} days:\n`+items.map(i=>`- ${i.d}: ${i.t}`).join('\n');
        }
        default:return'Unknown tool: '+toolName;
      }
    }catch(e){return'Tool error: '+e.message;}
  }

  // Build the tool description for the AI system prompt
  function getToolPrompt(){
    return`\n\nGRAPH TOOLS (you can use these to investigate before answering):
To use a tool, respond with ONLY a JSON object: {"tool":"tool_name","params":{"key":"value"}}
After receiving tool results, you can use another tool or give your final answer.
You have up to 3 tool uses per question. Use them when you need more information.
Available tools:
${GRAPH_TOOLS.map(t=>`- ${t.name}: ${t.description}`).join('\n')}

IMPORTANT: Only use tools when you genuinely need more information. For simple questions, answer directly.
When you're ready to give your final answer, just respond normally (no JSON, no tool call).`;
  }

  // The ReAct loop — alternate between AI thinking and tool execution
  async function reactLoop(question, initialCtx, persona, maxSteps=3){
    let ctx=initialCtx;
    let toolHistory=[];
    let finalAnswer=null;

    const msgs=chatHistory.slice(-4).map(m=>({role:m.role==='user'?'user':'assistant',content:m.content}));
    msgs.push({role:'user',content:question});

    for(let step=0;step<maxSteps;step++){
      // Build system prompt with context + tool descriptions + tool history
      let systemPrompt=persona+'\n\n'+ctx+getToolPrompt();
      if(toolHistory.length){
        systemPrompt+='\n\nTOOL RESULTS FROM YOUR PREVIOUS CALLS:\n'+toolHistory.map((h,i)=>`[Call ${i+1}] ${h.tool}(${JSON.stringify(h.params)}) → ${h.result}`).join('\n\n');
      }

      const resp=await NX.askClaude(systemPrompt,msgs,400,false);
      const trimmed=(resp||'').trim();

      // Check if the AI wants to use a tool
      let toolCall=null;
      try{
        // Look for JSON tool call in the response
        const jsonStart=trimmed.indexOf('{');
        const jsonEnd=trimmed.lastIndexOf('}');
        if(jsonStart!==-1&&jsonEnd>jsonStart){
          const jsonStr=trimmed.slice(jsonStart,jsonEnd+1);
          const parsed=JSON.parse(jsonStr);
          if(parsed.tool&&GRAPH_TOOLS.some(t=>t.name===parsed.tool)){
            toolCall=parsed;
          }
        }
      }catch(e){/* Not JSON — it's a final answer */}

      if(toolCall){
        // Execute the tool
        const result=await executeGraphTool(toolCall.tool,toolCall.params||{});
        toolHistory.push({tool:toolCall.tool,params:toolCall.params||{},result:result.slice(0,800)});

        // Update the thinking indicator
        const thinkEl=document.querySelector('.chat-thinking');
        if(thinkEl){
          const toolLabel=toolCall.tool.replace(/_/g,' ');
          thinkEl.textContent=`🧠 Investigating: ${toolLabel}...`;
        }
      }else{
        // No tool call — this is the final answer
        finalAnswer=trimmed;
        break;
      }
    }

    // If we exhausted steps without a final answer, force one
    if(!finalAnswer){
      const systemPrompt=persona+'\n\n'+ctx+'\n\nTOOL RESULTS:\n'+toolHistory.map((h,i)=>`[${h.tool}] ${h.result}`).join('\n\n')+'\n\nNow give your final answer based on everything you found. No more tool calls.';
      finalAnswer=await NX.askClaude(systemPrompt,msgs,400,false);
    }

    return{answer:finalAnswer,toolsUsed:toolHistory};
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
    // Tap anywhere on the HUD body also expands (not just the input)
    // so users can dismiss the empty state and start browsing chat history
    hud.addEventListener('click', (e) => {
      if (hud.classList.contains('expanded')) return;
      // Don't expand if user tapped one of the interactive buttons
      // (they should perform their action, not just expand)
      if (e.target.closest('.hud-handle, #chatSend, #resetBtn')) return;
      hud.classList.add('expanded');
      dim.classList.add('active');
      if (NX.brain && NX.brain.closePanel) NX.brain.closePanel();
      // If they tapped the input area, also focus it
      if (e.target.closest('.hud-input') || e.target === hud) {
        setTimeout(() => i.focus(), 50);
      }
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

  function resetChat(){stopSpeaking();chatHistory=[];chatActive=false;
    const _cm = document.getElementById('chatMessages'); if (_cm) _cm.innerHTML = '';
    const _bw = document.getElementById('brainWelcome');  if (_bw) _bw.style.display = '';
    const _be = document.getElementById('brainExamples'); if (_be) _be.style.display = '';
    const _bd = document.getElementById('brainDim');      if (_bd) _bd.classList.remove('active');
    const _rb = document.getElementById('resetBtn');      if (_rb) _rb.style.display = 'none';
    const _hud = document.getElementById('chatHud');      if (_hud) _hud.classList.remove('expanded');
    NX.brain.state.activatedNodes=new Set();NX.brain.wakePhysics();
  }

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
      // Recency boost (access frequency)
      if(n.access_count>10)s+=2;else if(n.access_count>3)s+=1;
      // ═══ TEMPORAL DECAY (Layer 3) — exponential decay based on data age ═══
      const relDate=n.last_relevant_date||null;
      const sources=n.source_emails||[];
      let newestMs=0;
      if(relDate)newestMs=new Date(relDate).getTime();
      else if(sources.length){newestMs=sources.reduce((max,src)=>{const d=new Date(src.date||0).getTime();return d>max?d:max;},0);}
      if(newestMs>0){
        const ageInDays=(now-newestMs)/86400000;
        // Exponential decay: halves every 90 days
        const decayFactor=Math.pow(0.5,ageInDays/90);
        // Recent items get boosted, old items get penalized
        if(ageInDays<14)s+=4;       // Last 2 weeks: strong boost
        else if(ageInDays<30)s+=2;  // Last month: mild boost
        else if(ageInDays<90)s+=0;  // 1-3 months: neutral
        else s-=Math.min(4,Math.floor((ageInDays-90)/60)); // Older: increasing penalty
        // Also scale the total score by decay
        s=Math.max(1,Math.round(s*Math.max(0.3,decayFactor)));
      }
      // Bridge/god node boost (palace structure)
      if(n.community_role==='god')s+=3;
      if(n.community_role==='bridge')s+=2;
      return{node:n,score:s};
    }).filter(s=>s.score>0).sort((a,b)=>b.score-a.score);

    const rel=sc.slice(0,8).map(s=>s.node);
    // ═══ MULTI-HOP TRAVERSAL (Layer 4) — follow 2-3 hops weighted by confidence ═══
    const hopNodes=new Map(); // id -> {node, hopDistance, confidence}
    const seenIds=new Set(rel.map(n=>n.id));

    // Hop 1: direct links from top results
    rel.slice(0,4).forEach(n=>{
      const conf=n.link_confidence||{};
      (n.links||[]).forEach(lid=>{
        if(seenIds.has(lid))return;
        const linked=NX.nodes.find(nn=>nn.id===lid);
        if(!linked||linked.is_private)return;
        const linkConf=conf[lid]||'inferred';
        const weight=linkConf==='extracted'?1.0:0.6;
        hopNodes.set(lid,{node:linked,hop:1,weight});
        seenIds.add(lid);
      });
    });

    // Hop 2: links from hop-1 nodes (only follow extracted links at hop 2)
    const hop1Ids=[...hopNodes.entries()].filter(([,v])=>v.hop===1&&v.weight>0.5).map(([id])=>id);
    hop1Ids.slice(0,6).forEach(h1id=>{
      const h1node=hopNodes.get(h1id)?.node;
      if(!h1node)return;
      const conf=h1node.link_confidence||{};
      (h1node.links||[]).forEach(lid=>{
        if(seenIds.has(lid))return;
        const linked=NX.nodes.find(nn=>nn.id===lid);
        if(!linked||linked.is_private)return;
        const linkConf=conf[lid]||'inferred';
        if(linkConf!=='extracted')return; // Only follow strong links at hop 2
        hopNodes.set(lid,{node:linked,hop:2,weight:0.4});
        seenIds.add(lid);
      });
    });

    // Hop 3: only for "deep dive" queries, only god/bridge nodes
    if(/deep dive|thorough|tell me everything|full picture|investigate/i.test(q)){
      const hop2Ids=[...hopNodes.entries()].filter(([,v])=>v.hop===2).map(([id])=>id);
      hop2Ids.slice(0,4).forEach(h2id=>{
        const h2node=hopNodes.get(h2id)?.node;
        if(!h2node)return;
        (h2node.links||[]).forEach(lid=>{
          if(seenIds.has(lid))return;
          const linked=NX.nodes.find(nn=>nn.id===lid);
          if(!linked||linked.is_private)return;
          if(linked.community_role!=='god'&&linked.community_role!=='bridge')return;
          hopNodes.set(lid,{node:linked,hop:3,weight:0.2});
          seenIds.add(lid);
        });
      });
    }

    // Sort hop nodes by weight, take top ones
    const sortedHops=[...hopNodes.values()].sort((a,b)=>b.weight-a.weight).slice(0,8);
    const linkedNodes=sortedHops.map(h=>h.node);
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

    const idx=NX.nodes.filter(n=>!n.is_private).sort((a,b)=>(b.access_count||0)-(a.access_count||0)).slice(0,20).map(n=>`${n.name} (${n.category})`).join(', ');

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
    // ═══ COMMUNITY SUMMARIES (Layer 1 — GraphRAG) ═══
    let summaryCtx='';
    if(hasCommunities){
      const relCommIds=[...new Set(allRelevant.map(n=>n.community_id).filter(Boolean))];
      try{
        const{data:comms}=await NX.sb.from('communities').select('community_id,label,summary').in('community_id',relCommIds);
        if(comms?.length){
          const withSummary=comms.filter(c=>c.summary);
          if(withSummary.length){
            summaryCtx='\n\nCOMMUNITY INTELLIGENCE:\n'+withSummary.map(c=>`${c.label}: ${c.summary}`).join('\n');
          }
        }
      }catch(e){}
    }

    // ═══ PATTERN PREDICTIONS (Layer 6) ═══
    let patternCtx='';
    try{
      const weekAhead=new Date(Date.now()+7*86400000).toISOString().split('T')[0];
      const{data:pats}=await NX.sb.from('patterns').select('*').lte('next_predicted',weekAhead).eq('active',true).limit(5);
      if(pats?.length){
        patternCtx='\n\nPREDICTED PATTERNS:\n'+pats.map(p=>`${p.entity_name}: ${p.pattern_type} (next: ${p.next_predicted}, every ~${p.interval_days} days, ${Math.round(p.confidence*100)}% confidence)`).join('\n');
      }
    }catch(e){}

    // ═══ MORNING BRIEF (Layer 2) ═══
    let briefCtx='';
    try{
      const todayStr=new Date().toISOString().split('T')[0];
      const{data:brief}=await NX.sb.from('briefs').select('brief_text').eq('brief_date',todayStr).limit(1);
      if(brief?.length&&brief[0].brief_text){
        briefCtx='\n\nTODAY\'S BRIEF:\n'+brief[0].brief_text;
      }
    }catch(e){}

    return`RELEVANT NODES:\n${det}${palaceCtx}${summaryCtx}${patternCtx}${briefCtx}\n\nFULL INDEX (${NX.nodes.length} nodes):\n${idx}${memory}${ev}${tickets}${cleanStatus}`;
  }

  async function askAI(){
    const i=document.getElementById('chatInput'),q=i?.value?.trim();if(!q)return;
    i.value='';const sb=document.getElementById('chatSend');if(sb)sb.disabled=true;
    try{
    // These elements live in the legacy chat-hud; null-safe so chatview
    // (which doesn't render them) doesn't throw when askAI fires.
    const _bw = document.getElementById('brainWelcome');   if (_bw) _bw.style.display = 'none';
    const _be = document.getElementById('brainExamples');  if (_be) _be.style.display = 'none';
    const _bd = document.getElementById('brainDim');       if (_bd) _bd.classList.add('active');
    const _hud = document.getElementById('chatHud');       if (_hud) { _hud.classList.add('expanded'); _hud.classList.remove('collapsed'); }
    const _rb = document.getElementById('resetBtn');       if (_rb) _rb.style.display = '';
    chatActive=true;addB(q,'user');chatHistory.push({role:'user',content:q});
    if(NX.syslog)NX.syslog('chat_ask',q.slice(0,80));
    showTyping();
    if(!NX.getApiKey()){
      hideTyping();
      // The 'noApiKey' i18n key was never defined — would render the
      // raw key text. Use a real message that tells the user how to fix.
      const lang = NX.i18n ? NX.i18n.getLang() : 'en';
      const msg = lang === 'es'
        ? 'No tengo una clave de API configurada. Abre Admin → Configurar para añadir tu clave de Anthropic.'
        : "I don't have an API key configured. Open Admin → Configure to add your Anthropic API key.";
      addB(msg,'ai');
      return;
    }
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
      const complex=isComplex(q);
      let ctx;

      if(complex){
        // ═══ TIER 1: Query Decomposition ═══
        th.textContent='🧠 Analyzing question...';
        const subQueries=await decomposeQuery(q);
        if(subQueries.length>1){
          th.textContent=`🔍 Searching ${subQueries.length} angles...`;
        }
        // Multi-query retrieval — searches from each sub-question angle
        const multiNodes=await getCtxMulti(subQueries);
        // Build context string from multi-query results
        const det=multiNodes.map(n=>{
          const src=(n.source_emails||[]).slice(0,2).map(s=>`[${s.date||'?'} from ${s.from||'?'}] ${(s.subject||'').slice(0,40)}`).join('; ');
          return`[${n.category}] ${n.name}: ${n.notes||''}${src?'\n  Sources: '+src:''}`;
        }).join('\n');
        const idx=NX.nodes.filter(n=>!n.is_private).sort((a,b)=>(b.access_count||0)-(a.access_count||0)).slice(0,20).map(n=>`${n.name} (${n.category})`).join(', ');
        ctx=`RELEVANT NODES (from ${subQueries.length} search angles):\n${det}\n\nFULL INDEX (${NX.nodes.length} nodes):\n${idx}`;
        // Append community summaries, patterns, brief
        try{
          const commIds=[...new Set(multiNodes.map(n=>n.community_id).filter(Boolean))];
          if(commIds.length){
            const{data:comms}=await NX.sb.from('communities').select('community_id,label,summary').in('community_id',commIds);
            const withSummary=(comms||[]).filter(c=>c.summary);
            if(withSummary.length)ctx+='\n\nCOMMUNITY INTELLIGENCE:\n'+withSummary.map(c=>`${c.label}: ${c.summary}`).join('\n');
          }
        }catch(e){}
        try{
          const weekAhead=new Date(Date.now()+7*86400000).toISOString().split('T')[0];
          const{data:pats}=await NX.sb.from('patterns').select('*').lte('next_predicted',weekAhead).eq('active',true).limit(5);
          if(pats?.length)ctx+='\n\nPREDICTED PATTERNS:\n'+pats.map(p=>`${p.entity_name}: ${p.pattern_type} (next: ${p.next_predicted}, ~${p.interval_days}d, ${Math.round(p.confidence*100)}%)`).join('\n');
        }catch(e){}
        try{
          const todayStr=new Date().toISOString().split('T')[0];
          const{data:brief}=await NX.sb.from('briefs').select('brief_text').eq('brief_date',todayStr).limit(1);
          if(brief?.length&&brief[0].brief_text)ctx+='\n\nTODAY\'S BRIEF:\n'+brief[0].brief_text;
        }catch(e){}
      }else{
        // Simple question — use MEMORY (filtered by wing/room, no FULL INDEX bloat)
        ctx=window.MEMORY ? await MEMORY.getContext(q, SESSION_ID) : await getCtx(q);
      }

      // ═══ TIER 2: ReAct Loop for complex questions, single-pass for simple ═══
      let cleanAns,confidence='';
      const persona=getPERSONA();

      if(complex){
        th.textContent='🧠 Reasoning...';
        const{answer,toolsUsed}=await reactLoop(q,ctx,persona,3);
        cleanAns=(answer||'No response.');
        // Show tool usage indicator if tools were used
        if(toolsUsed.length){
          const toolNames=[...new Set(toolsUsed.map(t=>t.tool.replace(/_/g,' ')))];
          const toolNote=document.createElement('div');
          toolNote.className='chat-tool-note';
          toolNote.textContent=`investigated: ${toolNames.join(', ')}`;
          th.parentElement?.insertBefore(toolNote,th);
        }
      }else{
        // Simple single-pass
        const msgs=chatHistory.slice(-6).map(m=>({role:m.role==='user'?'user':'assistant',content:m.content}));
        cleanAns=await NX.askClaude(persona+'\n\n'+ctx,msgs,300,false)||'No response.';
      }

      clearInterval(searchDots);
      // Parse confidence tag
      cleanAns=cleanAns.replace(/\[confidence:(high|medium|low)\]/i,(m,level)=>{confidence=level.toLowerCase();return '';}).trim();
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
      // ═══ COMPOUND ACTIONS (Layer 5) — detect and suggest multi-step actions ═══
      if(detectCompound(q)&&confidence!=='low'){
        handleCompoundAction(q,cleanAns);
      }
      // Save with wing/room metadata via MEMORY, falls back to direct insert if module not loaded
      if (window.MEMORY) { await MEMORY.save(SESSION_ID, q, cleanAns); }
      else { try{await NX.sb.from('chat_history').insert({question:q,answer:cleanAns,session_id:SESSION_ID,user_name:(NX.currentUser?NX.currentUser.name:'Unknown')});}catch(e){} }
      // Stage R: pulse the mini-galaxy — the brain just did work
      if (NX.homeGalaxyPulse) NX.homeGalaxyPulse();
      // ═══ SELF-OPTIMIZATION — track chat quality ═══
      trackChatQuality(q,cleanAns,confidence);
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
    // Offer inline translation on completed AI bubbles. Skip typing/
    // thinking indicators (they're transient) and skip user messages
    // (user wrote them — no need). The button appears as a small 🌐
    // at the end of the text; one tap translates to the user's
    // preferred language with a "show original" toggle.
    if(type.includes('ai') && !type.includes('thinking') && window.NX?.tr){
      try{ NX.tr.inline(el); }catch(_){}
    }
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
  // VOICES array — order MATCHES the admin <select> values 0-19 in
  // index.html. Picking value=0 ("Adam") plays Adam's actual voice ID.
  // (This was previously misordered — admin and brain-chat had the
  // same names paired with different IDs, so the wrong voice always
  // played. Names+IDs are paired correctly throughout.)
  const VOICES=[
    {id:'pNInz6obpgDQGcFmaJgB',name:'Adam'},        // 0
    {id:'EXAVITQu4vr4xnSDxMaL',name:'Bella'},       // 1
    {id:'onwK4e9ZLuTAKqWW03F9',name:'Daniel'},      // 2
    {id:'XB0fDUnXU5powFXDhCwa',name:'Charlotte'},   // 3
    {id:'TX3LPaxmHKxFdv7VOQHJ',name:'Liam'},        // 4
    {id:'LcfcDJNUP1GQjkzn1xUU',name:'Emily'},       // 5
    {id:'yoZ06aMxZJJ28mfd3POQ',name:'Sam'},         // 6
    {id:'ThT5KcBeYPX3keUQqHPh',name:'Dorothy'},     // 7
    {id:'VR6AewLTigWG4xSOukaG',name:'Arnold'},      // 8
    {id:'pqHfZKP75CvOlQylNhV4',name:'Bill'},        // 9
    {id:'ErXwobaYiN019PkySvjV',name:'Antoni'},      // 10
    {id:'AZnzlk1XvdvUeBnXmlld',name:'Domi'},        // 11
    {id:'D38z5RcWu1voky8WS1ja',name:'Fin'},         // 12
    {id:'jsCqWAovK2LkecY7zXl4',name:'Freya'},       // 13
    {id:'jBpfuIE2acCO8z3wKNLl',name:'Gigi'},        // 14
    {id:'oWAxZDx7w5VEj9dCyTzz',name:'Grace'},       // 15
    {id:'SOYHLrjzK2X1ezoPC6cr',name:'Harry'},       // 16
    {id:'ZQe5CZNOzWyzPSCn5a3c',name:'James'},       // 17
    {id:'TxGEqnHWrfWFTfGW9XjX',name:'Josh'},        // 18
    {id:'21m00Tcm4TlvDq8ikWAM',name:'Rachel'},      // 19
  ];

  // ═══ CUSTOM VOICES ═══════════════════════════════════════════════════
  // Append-only list managed via admin UI. Stored as JSON array under
  //   localStorage: nexus_custom_voices
  // Each entry: { id, name, blurb, stability?, similarity?, style?, speed?, systemPrefix? }
  // Custom voices get indices STARTING AT 20 — they don't disturb the
  // 0–19 default voice mapping (which existing users have saved).
  // Per-voice tuning lets a persona like "Providentia" have its own
  // ElevenLabs voice_settings AND its own playback rate AND its own
  // system-prompt-prefix to shift the AI's character — not just timbre.
  function loadCustomVoices(){
    try{
      const raw=localStorage.getItem('nexus_custom_voices');
      if(!raw)return [];
      const arr=JSON.parse(raw);
      return Array.isArray(arr)?arr.filter(v=>v&&v.id&&v.name):[];
    }catch(e){
      console.warn('[brain-chat] loadCustomVoices:',e);
      return [];
    }
  }
  function getAllVoices(){
    return VOICES.concat(loadCustomVoices());
  }
  function getVoiceMeta(idx){
    const all=getAllVoices();
    if(idx>=0 && idx<all.length) return all[idx];
    return all[0];  // fallback to first voice
  }
  // Expose so chat-view.js, app.js, the persona sheet, etc., all see
  // the SAME merged list. Re-evaluated on every read so adding a new
  // custom voice in admin shows up immediately without page reload.
  Object.defineProperty(NX,'VOICES',{
    get(){return getAllVoices();},
    configurable:true,
  });
  NX.getVoiceMeta=getVoiceMeta;
  NX.reloadCustomVoices=()=>{
    // Hook for admin UI to fire after edits. Currently a no-op since
    // getAllVoices reads localStorage every call, but kept for future
    // caching changes.
    return getAllVoices().length;
  };
  function getVoiceIdx(){
    const stored=parseInt((NX.config&&NX.config.voice_idx!=null)?NX.config.voice_idx:(localStorage.getItem('nexus_voice_idx')||'0'));
    const total=getAllVoices().length;
    if(isNaN(stored)||total<=0)return 0;
    // Don't modulo — that would silently wrap a stored idx of 20
    // (Providentia) back to 0 (Charlotte) if the user temporarily
    // clears their custom voices. Clamp instead so it picks the last
    // valid voice.
    if(stored<0)return 0;
    if(stored>=total)return total-1;
    return stored;
  }
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
  // Read TTS rate from localStorage on every speak() call so the admin
  // slider's value takes effect immediately. Clamp 0.8–1.6 to stay
  // within both ElevenLabs (audio.playbackRate) and Web Speech API
  // (utterance.rate) safe ranges.
  function getVoiceSpeed(){
    const raw = parseFloat(localStorage.getItem('nexus_voice_speed') || '1.25');
    if (isNaN(raw)) return 1.25;
    return Math.max(0.8, Math.min(1.6, raw));
  }
  // Expose on NX for any module that wants the same value (admin echo,
  // future read-this-card playback, etc.)
  NX.getVoiceSpeed = getVoiceSpeed;
  // Expose stopSpeaking on NX so chat-view.js's mute toggle can cancel
  // any in-flight playback when the user mutes mid-utterance.
  NX.stopSpeaking = stopSpeaking;
  async function speak(text){
    // Respect the global voice-on toggle. If muted, do nothing —
    // even the brief request to ElevenLabs is wasted otherwise.
    if (localStorage.getItem('nx_voice_on') === '0') return;
    cvi = getVoiceIdx();
    // Pull the full voice metadata. For default voices this is just
    // {id, name}; for custom voices it can carry stability/similarity/
    // style/speed overrides. Per-voice speed wins over the global.
    const voice = getVoiceMeta(cvi);
    if (!voice || !voice.id) return;
    const speed = (voice.speed != null) ? voice.speed : getVoiceSpeed();
    // ElevenLabs voice_settings — defaults match the previous hardcoded
    // values so existing voices sound exactly as before. Custom voices
    // can override any/all of these.
    const stability      = (voice.stability      != null) ? voice.stability      : 0.35;
    const similarityBoost= (voice.similarity     != null) ? voice.similarity     : 0.82;
    const style          = (voice.style          != null) ? voice.style          : 0.45;
    const ek = NX.getElevenLabsKey();
    if (ek) {
      try {
        const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'xi-api-key': ek },
          body: JSON.stringify({
            text: text.slice(0, 800),
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
              stability,
              similarity_boost: similarityBoost,
              style,
              use_speaker_boost: true,
            }
          })
        });
        if (r.ok) {
          const bl = await r.blob(), u = URL.createObjectURL(bl);
          if (currentAudio) { currentAudio.pause(); currentAudio = null; }
          const a = new Audio(u);
          a.playbackRate = speed;
          currentAudio = a;
          a.play();
          a.onended = () => { URL.revokeObjectURL(u); currentAudio = null; };
          return;
        }
      } catch(e) {}
    }
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(0, 600));
    if (pv) u.voice = pv;
    u.rate = speed;
    speechSynthesis.speak(u);
  }
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

  // ─── Chat-view integration (Stage B) ──────────────────────────────
  // The new full-screen chat view (chat-view.js) fires custom events
  // rather than manipulating DOM directly. This keeps it decoupled.
  NX.brain.askAI = askAI;
  window.addEventListener('nx-chat-ask', (e) => {
    const q = e?.detail?.q;
    if (!q) return;
    const input = document.getElementById('chatInput');
    if (input) { input.value = q; input.dispatchEvent(new Event('input')); }
    askAI();
  });
  window.addEventListener('nx-voice-toggle', (e) => {
    // keep brain-chat's voiceOn module var in sync with chatview toggle
    voiceOn = !!e?.detail?.on;
    const vb = document.getElementById('voiceBtn');
    if (vb) vb.classList.toggle('on', voiceOn);
  });
  window.addEventListener('nx-voice-idx-change', (e) => {
    const idx = Number(e?.detail?.idx);
    if (!Number.isFinite(idx)) return;
    cvi = idx % VOICES.length;
    localStorage.setItem('nexus_voice_idx', String(cvi));
  });
})();
