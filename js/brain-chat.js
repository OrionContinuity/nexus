/* NEXUS Brain Chat — AI, voice, commands, research */
(function(){
  if(!localStorage.getItem('nexus_session_id'))localStorage.setItem('nexus_session_id',crypto.randomUUID?crypto.randomUUID():'s_'+Date.now()+'_'+Math.random().toString(36).slice(2));
  const SESSION_ID=localStorage.getItem('nexus_session_id');
  let chatHistory=[],voiceOn=false,recognition=null,chatActive=false;

  const PERSONA=`You are NEXUS, the AI ops brain for Alfredo Ortiz — Suerte, Este, Bar Toti (Austin TX).

YOUR CAPABILITIES (tell users about these when relevant):
- You have email source references for nodes — cite them when asked "why" or "where from"
- You remember past conversations across sessions
- Users can say "research [topic]" and you will search the web for live info and auto-create nodes
- Users can say "log that [something]" to create a daily log entry
- Users can say "add card: [task]" to create a kanban card
- The Mail Monitor in Ingest can scan Gmail for invoices, receipts, and attachments and link them to nodes

PERSONALITY: Sharp, concise, warm. Dry wit. Helpful FIRST, funny second. Respond in whatever language asked (EN/ES). Be CONCISE.

When you don't know something, suggest the user try "research [topic]" so you can search the web for it. Never say you can't search — you CAN via the research command.`;

  function checkApiKey(){const b=document.getElementById('apiBanner');if(b)b.style.display=NX.getApiKey()?'none':'flex';}

  function buildDynamicChips(){
    const el=document.getElementById('brainExamples');if(!el)return;el.innerHTML='';
    const top=NX.nodes.filter(n=>!n.is_private).sort((a,b)=>(b.access_count||0)-(a.access_count||0)).slice(0,6);
    const prompts=top.map(n=>{if(n.category==='contractors')return`Who is ${n.name}?`;if(n.category==='equipment')return`${n.name} status?`;if(n.category==='procedure')return`${n.name}?`;return`Tell me about ${n.name}`;});
    if(prompts.length<3)prompts.push('What do you know?','Show me all contractors','Protocolo de limpieza?');
    prompts.slice(0,6).forEach(p=>{const b=document.createElement('button');b.className='brain-ex';b.textContent=p;b.addEventListener('click',()=>{document.getElementById('chatInput').value=p;document.getElementById('chatSend').disabled=false;askAI();});el.appendChild(b);});
  }

  // Commands
  const TASK_RX=[{rx:/^(?:log|note|record)\s+(?:that\s+)?(.+)/i,type:'log'},{rx:/^(?:add card|create task|todo)\s*:?\s*(.+)/i,type:'card'},{rx:/^(?:research|look up|search|find info)\s+(.+)/i,type:'research'}];
  function detectTask(q){for(const p of TASK_RX){const m=q.match(p.rx);if(m)return{type:p.type,content:m[1]};}return null;}
  async function handleTask(task){if(task.type==='log'){const{error}=await NX.sb.from('daily_logs').insert({entry:task.content});return error?'Failed to log.':`Logged: "${task.content}"`;}if(task.type==='card'){const{error}=await NX.sb.from('kanban_cards').insert({title:task.content,column_name:'todo'});return error?'Failed.':`Card created: "${task.content}"`;}return null;}

  async function handleResearch(topic){
    addB(`Researching "${topic}"...`,'ai thinking');
    try{const webResult=await NX.askClaude('You are a research assistant for restaurant operations (Suerte, Este, Bar Toti — Austin TX). Search the web and provide detailed, factual information. Include specs, model numbers, pricing, warranty, dealer contacts.',[{role:'user',content:`Research: ${topic}`}],2000,true);
    const resEl=addB(webResult||'No results.','ai');resEl.classList.remove('chat-thinking');chatHistory.push({role:'assistant',content:webResult});if(voiceOn)speak(webResult);
    addB('Extracting nodes...','ai thinking');
    const extraction=await NX.askClaude('Extract ALL knowledge as nodes. RESPOND ONLY RAW JSON: {"nodes":[{"name":"...","category":"equipment|contractors|vendors|procedure|projects|people|systems|parts|location","tags":["..."],"notes":"..."}]}',[{role:'user',content:webResult}],2000);
    let json=extraction.replace(/```json\s*/gi,'').replace(/```\s*/g,'');const s=json.indexOf('{'),e=json.lastIndexOf('}');
    if(s!==-1&&e>s){json=json.slice(s,e+1);const parsed=JSON.parse(json);
      if(parsed.nodes&&parsed.nodes.length){let created=0;const vc=['equipment','contractors','vendors','procedure','projects','people','systems','parts','location'];const ex=new Set(NX.nodes.map(n=>(n.name||'').toLowerCase()));
        for(const n of parsed.nodes){const nm=(n.name||'').trim();if(!nm||nm.length<2||ex.has(nm.toLowerCase()))continue;const{error}=await NX.sb.from('nodes').insert({name:nm.slice(0,200),category:vc.includes(n.category)?n.category:'equipment',tags:Array.isArray(n.tags)?n.tags.filter(x=>typeof x==='string').slice(0,20):[],notes:(n.notes||'').slice(0,2000),links:[],access_count:1,source_emails:[{from:'Web Research',subject:topic,date:new Date().toISOString().split('T')[0]}]});if(!error){created++;ex.add(nm.toLowerCase());}}
        const c2=addB(`✓ ${created} node${created!==1?'s':''} added.`,'ai');c2.classList.remove('chat-thinking');await NX.loadNodes();if(NX.brain)NX.brain.init();
      }else{const ne=addB('No new nodes.','ai');ne.classList.remove('chat-thinking');}}
    try{await NX.sb.from('chat_history').insert({question:'research: '+topic,answer:webResult,session_id:SESSION_ID});}catch(e){}
    }catch(e){const ee=addB('Research failed: '+(e.message||'error'),'ai');ee.classList.remove('chat-thinking');}
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
    // Voice label
    if(localStorage.getItem('nexus_voice_seen')){const l=document.getElementById('micLabel');if(l)l.classList.add('hidden');}
    else localStorage.setItem('nexus_voice_seen','1');
    setupVoice();
    // Offline
    window.addEventListener('online',()=>{document.getElementById('offlineBanner').style.display='none';});
    window.addEventListener('offline',()=>{document.getElementById('offlineBanner').style.display='block';});
    if(!navigator.onLine)document.getElementById('offlineBanner').style.display='block';
  }

  function resetChat(){chatHistory=[];chatActive=false;document.getElementById('chatMessages').innerHTML='';document.getElementById('brainWelcome').style.display='';document.getElementById('brainExamples').style.display='';document.getElementById('brainDim').classList.remove('active');document.getElementById('resetBtn').style.display='none';NX.brain.state.activatedNodes=new Set();NX.brain.wakePhysics();}

  async function getCtx(q){const w=q.toLowerCase().split(/\s+/).filter(x=>x.length>2);const sc=NX.nodes.map(n=>{let s=0;const t=(n.name+' '+n.category+' '+(n.tags||[]).join(' ')+' '+(n.notes||'')).toLowerCase();w.forEach(x=>{if(t.includes(x))s+=t.split(x).length-1;});if(n.name.toLowerCase().includes(q.toLowerCase()))s+=10;return{node:n,score:s};}).filter(s=>s.score>0).sort((a,b)=>b.score-a.score);const rel=sc.slice(0,10).map(s=>s.node);const idx=NX.nodes.filter(n=>!n.is_private).map(n=>`${n.name} (${n.category})`).join(', ');const det=rel.map(n=>{let src='';const sources=n.sources||n.source_emails;if(sources&&sources.length)src=' [Sources: '+sources.map(s=>`${s.from} "${s.subject}" ${s.date}`).join('; ')+']';return`[${n.category}] ${n.name}: ${n.notes}${src}`;}).join('\n');const relIds=rel.map(n=>n.id);NX.brain.state.activatedNodes=new Set(relIds);NX.brain.wakePhysics();setTimeout(()=>{NX.brain.state.activatedNodes=new Set();},12000);NX.trackAccess(relIds);const memory=await NX.fetchMemory(q);const ce=NX.brain.state.contractorEvents;let ev='';if(ce.length)ev='\n\nUPCOMING:\n'+ce.slice(0,8).map(e=>`${e.contractor_name} @ ${e.location||'?'} ${e.event_date}`).join('\n');return`RELEVANT NODES:\n${det}\n\nINDEX (${NX.nodes.length}):\n${idx}${memory}${ev}`;}

  async function askAI(){
    if(!navigator.onLine){addB("Can't reach NEXUS — check WiFi.",'ai');return;}
    const i=document.getElementById('chatInput'),q=i.value.trim();if(!q)return;
    i.value='';document.getElementById('chatSend').disabled=true;document.getElementById('brainWelcome').style.display='none';document.getElementById('brainExamples').style.display='none';document.getElementById('brainDim').classList.add('active');document.getElementById('chatHud').classList.add('expanded');document.getElementById('chatHud').classList.remove('collapsed');document.getElementById('resetBtn').style.display='';chatActive=true;addB(q,'user');chatHistory.push({role:'user',content:q});
    if(!NX.getApiKey()){addB('No API key set — open Admin ⚙ to add your Anthropic key.','ai');return;}
    const task=detectTask(q);if(task){
      if(task.type==='research'){try{await handleResearch(task.content);}catch(e){addB('Research error: '+e.message,'ai');}return;}
      try{const result=await handleTask(task);if(result){addB(result,'ai');chatHistory.push({role:'assistant',content:result});if(voiceOn)speak(result);try{await NX.sb.from('chat_history').insert({question:q,answer:result,session_id:SESSION_ID});}catch(e){}return;}}catch(e){addB('Task error: '+e.message,'ai');return;}}
    const th=addB(`Searching ${NX.nodes.length} nodes...`,'ai thinking');
    try{const ctx=await getCtx(q);const msgs=chatHistory.slice(-6).map(m=>({role:m.role==='user'?'user':'assistant',content:m.content}));
      const ans=await NX.askClaude(PERSONA+'\n\n'+ctx,msgs,800,false);
      th.textContent=ans||'No response received.';th.classList.remove('chat-thinking');chatHistory.push({role:'assistant',content:ans});if(voiceOn)speak(ans);
      try{await NX.sb.from('chat_history').insert({question:q,answer:ans,session_id:SESSION_ID});}catch(e){}
    }catch(e){th.textContent='Error: '+(e.message||'Unknown');th.classList.remove('chat-thinking');}}
  function addB(t,type){const el=document.createElement('div');el.className='chat-bubble chat-'+(type.includes('user')?'user':'ai');if(type.includes('thinking'))el.classList.add('chat-thinking');el.textContent=t;el.style[type.includes('user')?'marginLeft':'marginRight']='auto';const c=document.getElementById('chatMessages');c.appendChild(el);c.scrollTop=c.scrollHeight;return el;}

  // Voice
  let pv=null;const VOICES=[{id:'pNInz6obpgDQGcFmaJgB',name:'Adam'},{id:'EXAVITQu4vr4xnSDxMaL',name:'Bella'},{id:'onwK4e9ZLuTAKqWW03F9',name:'Daniel'},{id:'XB0fDUnXU5powFXDhCwa',name:'Charlotte'},{id:'TX3LPaxmHKxFdv7VOQHJ',name:'Liam'},{id:'jBpfuIE2acCO8z3wKNLl',name:'Emily'},{id:'yoZ06aMxZJJ28mfd3POQ',name:'Sam'},{id:'ThT5KcBeYPX3keUQqHPh',name:'Dorothy'},{id:'VR6AewLTigWG4xSOukaG',name:'Arnold'},{id:'pqHfZKP75CvOlQylNhV4',name:'Bill'}];
  let cvi=parseInt(localStorage.getItem('nexus_voice_idx')||'0')%VOICES.length;
  function setupVoice(){document.getElementById('micBtn').addEventListener('click',toggleMic);const vb=document.getElementById('voiceBtn');let pt=null;vb.addEventListener('click',()=>{voiceOn=!voiceOn;vb.classList.toggle('on',voiceOn);});vb.addEventListener('pointerdown',()=>{pt=setTimeout(()=>{cvi=(cvi+1)%VOICES.length;localStorage.setItem('nexus_voice_idx',cvi);voiceOn=true;vb.classList.add('on');speak(`${VOICES[cvi].name} here.`);pt=null;},600);});vb.addEventListener('pointerup',()=>{if(pt)clearTimeout(pt);});vb.addEventListener('pointerleave',()=>{if(pt)clearTimeout(pt);});if('speechSynthesis'in window){const pk=()=>{const v=speechSynthesis.getVoices();for(const n of['Samantha','Karen','Daniel','Microsoft Aria']){const f=v.find(x=>x.name.includes(n));if(f){pv=f;break;}}};pk();speechSynthesis.onvoiceschanged=pk;}}
  function toggleMic(){const b=document.getElementById('micBtn');if(recognition){recognition.stop();recognition=null;b.classList.remove('recording');return;}if(!('webkitSpeechRecognition'in window||'SpeechRecognition'in window))return;const SR=window.SpeechRecognition||window.webkitSpeechRecognition;recognition=new SR();recognition.continuous=false;recognition.interimResults=false;recognition.onresult=e=>{document.getElementById('chatInput').value=e.results[0][0].transcript;document.getElementById('chatSend').disabled=false;b.classList.remove('recording');recognition=null;askAI();};recognition.onerror=()=>{b.classList.remove('recording');recognition=null;};recognition.onend=()=>{b.classList.remove('recording');recognition=null;};b.classList.add('recording');recognition.start();}
  async function speak(text){const ek=NX.getElevenLabsKey();if(ek){try{const r=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICES[cvi].id}`,{method:'POST',headers:{'Content-Type':'application/json','xi-api-key':ek},body:JSON.stringify({text:text.slice(0,800),model_id:'eleven_turbo_v2',voice_settings:{stability:.45,similarity_boost:.78,style:.35,use_speaker_boost:true}})});if(r.ok){const bl=await r.blob(),u=URL.createObjectURL(bl),a=new Audio(u);a.play();a.onended=()=>URL.revokeObjectURL(u);return;}}catch(e){}}if(!('speechSynthesis'in window))return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text.slice(0,600));if(pv)u.voice=pv;u.rate=.95;speechSynthesis.speak(u);}

  // Register with brain
  NX.brain.initChat=setupChat;
})();
