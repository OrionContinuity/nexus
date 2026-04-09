/* NEXUS Brain v6 — Audit-hardened */
(function(){
  const canvas=document.getElementById('brainCanvas'),ctx=canvas.getContext('2d');
  let W,H,time=0,particles=[],transform={x:0,y:0,scale:1};
  let dragging=false,dragStart={x:0,y:0},dragTransStart={x:0,y:0};
  let hoverNode=null,activeNode=null,activatedNodes=new Set(),searchHits=new Set();
  let chatHistory=[],voiceOn=false,recognition=null,listViewOpen=false,chatActive=false,contractorEvents=[];
  let listFilter='all',listSortMode='az';

  // Session ID for continuity
  if(!localStorage.getItem('nexus_session_id'))localStorage.setItem('nexus_session_id',crypto.randomUUID?crypto.randomUUID():'s_'+Date.now()+'_'+Math.random().toString(36).slice(2));
  const SESSION_ID=localStorage.getItem('nexus_session_id');

  const REP=500,ATT=0.0015,LINK=0.004,CPULL=0.00025,DAMP=0.84,MAXV=4;
  const IDC=160,IDT=110,IDL=90,BR=9,AR=18,SR=14;
  const CC={location:{r:220,g:186,b:140},equipment:{r:120,g:160,b:210},procedure:{r:140,g:175,b:120},contractors:{r:210,g:148,b:120},vendors:{r:170,g:140,b:210},projects:{r:210,g:190,b:120},systems:{r:120,g:210,b:190},parts:{r:180,g:158,b:158},people:{r:180,g:160,b:210}};
  function cc(cat,a){const c=CC[cat]||CC.equipment;return`rgba(${c.r},${c.g},${c.b},${a})`;}

  const PERSONA=`You are NEXUS, the AI ops brain for Alfredo Ortiz — Suerte, Este, Bar Toti (Austin TX). You have email source references for nodes — cite them when asked "why" or "where from". You remember past conversations. Sharp, concise, warm. Dry wit. Helpful FIRST. EN/ES.`;

  function init(){
    resize();buildParticles();for(let i=0;i<300;i++)physics();
    setupChat();setupSearch();setupCanvas();setupVoice();setupListView();setupContractorEvents();
    checkApiKey();checkEmpty();buildDynamicChips();
    // Hide voice label after first session
    if(localStorage.getItem('nexus_voice_seen')){const l=document.getElementById('micLabel');if(l)l.classList.add('hidden');}
    else localStorage.setItem('nexus_voice_seen','1');
    // Online/offline detection
    window.addEventListener('online',()=>{document.getElementById('offlineBanner').style.display='none';});
    window.addEventListener('offline',()=>{document.getElementById('offlineBanner').style.display='block';});
    if(!navigator.onLine)document.getElementById('offlineBanner').style.display='block';
    draw();
  }
  function resize(){const r=canvas.parentElement.getBoundingClientRect();W=r.width*2;H=r.height*2;canvas.width=W;canvas.height=H;}
  window.addEventListener('resize',()=>{if(document.getElementById('brainView').classList.contains('active'))resize();});
  function checkApiKey(){const b=document.getElementById('apiBanner');if(b)b.style.display=NX.getApiKey()?'none':'flex';}
  function checkEmpty(){const e=document.getElementById('canvasEmpty');if(e)e.style.display=NX.nodes.length<=1?'flex':'none';}

  // Dynamic example chips from most-accessed nodes
  function buildDynamicChips(){
    const el=document.getElementById('brainExamples');if(!el)return;el.innerHTML='';
    const top=NX.nodes.filter(n=>!n.is_private).sort((a,b)=>(b.access_count||0)-(a.access_count||0)).slice(0,6);
    const prompts=top.map(n=>{
      if(n.category==='contractors')return`Who is ${n.name}?`;
      if(n.category==='equipment')return`${n.name} status?`;
      if(n.category==='procedure')return`${n.name}?`;
      return`Tell me about ${n.name}`;
    });
    // Add a fallback if few nodes
    if(prompts.length<3)prompts.push('What do you know?','Show me all contractors','Protocolo de limpieza?');
    prompts.slice(0,6).forEach(p=>{const b=document.createElement('button');b.className='brain-ex';b.textContent=p;b.addEventListener('click',()=>{document.getElementById('chatInput').value=p;document.getElementById('chatSend').disabled=false;askAI();});el.appendChild(b);});
  }

  let linkMap={},catMap={},tagSets={};
  function buildParticles(){
    const nodes=NX.nodes.filter(n=>!n.is_private),cx=W/2,cy=H/2;
    const cats=[...new Set(nodes.map(n=>n.category))],ca={};cats.forEach((c,i)=>{ca[c]=(i/cats.length)*Math.PI*2;});
    particles=nodes.map(n=>{const b=ca[n.category]||0,j=(Math.random()-0.5)*1.4,d=200+Math.random()*500;return{id:n.id,x:cx+Math.cos(b+j)*d,y:cy+Math.sin(b+j)*d,vx:0,vy:0,node:n,cat:n.category,tags:n.tags||[],links:n.links||[],access:n.access_count||1};});
    linkMap={};catMap={};tagSets={};particles.forEach((p,i)=>{linkMap[p.id]=p;if(!catMap[p.cat])catMap[p.cat]=[];catMap[p.cat].push(i);tagSets[i]=new Set(p.tags);});
  }

  function physics(){const len=particles.length,cx=W/2,cy=H/2,ih=hoverNode!==null,CELL=200,grid={};for(let i=0;i<len;i++){const a=particles[i],k=Math.floor(a.x/CELL)+','+Math.floor(a.y/CELL);if(!grid[k])grid[k]=[];grid[k].push(i);}for(let i=0;i<len;i++){const a=particles[i];if(ih&&Math.hypot(a.x-hoverNode.x,a.y-hoverNode.y)<100){a.vx*=0.05;a.vy*=0.05;continue;}const gx=Math.floor(a.x/CELL),gy=Math.floor(a.y/CELL);for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++){const nb=grid[(gx+ox)+','+(gy+oy)];if(!nb)continue;for(let ni=0;ni<nb.length;ni++){const j=nb[ni];if(j<=i)continue;const b=particles[j];let dx=a.x-b.x,dy=a.y-b.y,dS=dx*dx+dy*dy;if(dS>160000)continue;let d=Math.sqrt(dS)||1,f=REP/dS;a.vx+=dx/d*f;a.vy+=dy/d*f;b.vx-=dx/d*f;b.vy-=dy/d*f;}}const sc=catMap[a.cat];if(sc)for(let ci=0;ci<sc.length;ci++){const j=sc[ci];if(j===i)continue;const b=particles[j];let dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1;a.vx+=dx/d*(d-IDC)*ATT;a.vy+=dy/d*(d-IDC)*ATT;}const aT=tagSets[i];if(aT&&aT.size>0)for(let ox=-2;ox<=2;ox++)for(let oy=-2;oy<=2;oy++){const nb=grid[(gx+ox)+','+(gy+oy)];if(!nb)continue;for(let ni=0;ni<nb.length;ni++){const j=nb[ni];if(j===i)continue;const bT=tagSets[j];if(!bT)continue;let sh=0;for(const t of aT)if(bT.has(t))sh++;if(!sh)continue;const b=particles[j];let dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1;a.vx+=dx/d*(d-IDT)*ATT*sh*1.2;a.vy+=dy/d*(d-IDT)*ATT*sh*1.2;}}a.links.forEach(lid=>{const b=linkMap[lid];if(!b)return;let dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1;a.vx+=dx/d*(d-IDL)*LINK;a.vy+=dy/d*(d-IDL)*LINK;});const nA=Math.min(a.access/60,1);a.vx+=(cx-a.x)*CPULL*(0.3+nA*0.7);a.vy+=(cy-a.y)*CPULL*(0.3+nA*0.7);
    // Center beacon repulsion — nodes can't touch the NEXUS core
    const cdist=Math.sqrt((a.x-cx)*(a.x-cx)+(a.y-cy)*(a.y-cy))||1;if(cdist<100){const cf=(100-cdist)*0.08;a.vx+=(a.x-cx)/cdist*cf;a.vy+=(a.y-cy)/cdist*cf;}
    a.vx*=DAMP;a.vy*=DAMP;const sp=Math.sqrt(a.vx*a.vx+a.vy*a.vy);if(sp>MAXV){a.vx=a.vx/sp*MAXV;a.vy=a.vy/sp*MAXV;}a.x+=a.vx;a.y+=a.vy;if(a.x<80)a.vx+=1;if(a.x>W-80)a.vx-=1;if(a.y<80)a.vy+=1;if(a.y>H-80)a.vy-=1;}}

  function draw(){time+=0.008;physics();ctx.save();ctx.fillStyle='#121214';ctx.fillRect(0,0,W,H);ctx.translate(transform.x,transform.y);ctx.scale(transform.scale,transform.scale);const cx=W/2,cy=H/2,isA=activatedNodes.size>0;
    particles.forEach(a=>a.links.forEach(lid=>{const b=linkMap[lid];if(!b)return;const hot=(activatedNodes.has(a.id)&&activatedNodes.has(b.id))||(searchHits.has(a.id)&&searchHits.has(b.id)),dim=isA&&!hot;const mx=(a.x+b.x)/2+Math.sin(time*.5+a.id)*5,my=(a.y+b.y)/2+Math.cos(time*.4+b.id)*5;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.quadraticCurveTo(mx,my,b.x,b.y);ctx.strokeStyle=hot?cc(a.cat,.7):dim?'rgba(212,182,138,.03)':'rgba(212,182,138,.3)';ctx.lineWidth=hot?3:1.8;ctx.stroke();if(hot)for(let k=0;k<2;k++){const pt=((time*.5+a.id*.1+k*.5)%1),t2=pt,t1=1-t2;ctx.beginPath();ctx.arc(t1*t1*a.x+2*t1*t2*mx+t2*t2*b.x,t1*t1*a.y+2*t1*t2*my+t2*t2*b.y,2.5,0,Math.PI*2);ctx.fillStyle=cc(a.cat,.8-pt*.5);ctx.fill();}}));
    particles.forEach(a=>{const hit=searchHits.has(a.id)||activatedNodes.has(a.id),act=activeNode&&activeNode.id===a.id,dim=isA&&!hit&&!act;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(a.x,a.y);ctx.strokeStyle=`rgba(212,182,138,${hit?.3:act?.35:dim?.01:.08})`;ctx.lineWidth=hit||act?1.5:.7;ctx.stroke();});
    const br=Math.sin(time*1.1),pr=55+br*5;ctx.shadowBlur=50;ctx.shadowColor='rgba(212,182,138,.6)';ctx.beginPath();ctx.arc(cx,cy,pr,0,Math.PI*2);ctx.fillStyle='#18181c';ctx.fill();ctx.strokeStyle=`rgba(212,182,138,${.6+br*.2})`;ctx.lineWidth=2.5;ctx.stroke();ctx.shadowBlur=0;ctx.fillStyle=`rgba(212,182,138,${.85+br*.1})`;ctx.font='600 18px JetBrains Mono';ctx.textAlign='center';ctx.fillText('NEXUS',cx,cy+6);
    particles.forEach(a=>{const hit=searchHits.has(a.id)||activatedNodes.has(a.id),act=activeNode&&activeNode.id===a.id,dim=isA&&!hit&&!act,p=Math.sin(time*1.5+a.id*.6);const sx=a.x*transform.scale+transform.x,sy=a.y*transform.scale+transform.y;if(sx<-80||sx>W+80||sy<-80||sy>H+80)return;const nr=act?AR+p*2:hit?SR+p*1.5:dim?5:BR+p*.5;ctx.shadowBlur=hit||act?18:6;ctx.shadowColor=hit||act?cc(a.cat,.8):cc(a.cat,.15);ctx.beginPath();ctx.arc(a.x,a.y,nr,0,Math.PI*2);ctx.fillStyle=cc(a.cat,(act?.95:hit?.8:dim?.08:.6)+p*.02);ctx.fill();ctx.strokeStyle=cc(a.cat,act?.7:hit?.55:dim?.04:.3);ctx.lineWidth=act?2:1;ctx.stroke();ctx.shadowBlur=0;const sr=nr*transform.scale;if(sr<5&&!hit&&!act)return;const label=a.node.name.length>22?a.node.name.slice(0,20)+'…':a.node.name,la=act?.95:hit?.9:dim?.06:.6;ctx.font=`${act?'500 ':'300 '}11px "Libre Franklin"`;ctx.textAlign='center';const tw=ctx.measureText(label).width,tx=a.x,ty=a.y-nr-7;if(la>.08){ctx.fillStyle=`rgba(0,0,0,${la*.55})`;ctx.beginPath();ctx.roundRect(tx-tw/2-6,ty-8,tw+12,16,4);ctx.fill();}ctx.fillStyle=`rgba(236,233,225,${la})`;ctx.fillText(label,tx,ty+3,220);});
    ctx.restore();requestAnimationFrame(draw);}

  function setupCanvas(){canvas.addEventListener('click',e=>{if(dragging)return;const p=stw(e.clientX,e.clientY);let cl=null,cd=35/transform.scale;particles.forEach(a=>{const d=Math.hypot(p.x-a.x,p.y-a.y);if(d<cd){cl=a;cd=d;}});if(cl)openPanel(cl.node);else closePanel();});canvas.addEventListener('mousemove',e=>{if(dragging)return;const p=stw(e.clientX,e.clientY);hoverNode=null;particles.forEach(a=>{if(Math.hypot(p.x-a.x,p.y-a.y)<25/transform.scale)hoverNode=a;});canvas.style.cursor=hoverNode?'pointer':'crosshair';});canvas.addEventListener('mousedown',e=>{if(e.button!==0)return;dragging=false;dragStart={x:e.clientX,y:e.clientY};dragTransStart={x:transform.x,y:transform.y};const onM=ev=>{const dx=ev.clientX-dragStart.x,dy=ev.clientY-dragStart.y;if(Math.abs(dx)+Math.abs(dy)>5)dragging=true;transform.x=dragTransStart.x+dx*2;transform.y=dragTransStart.y+dy*2;};const onU=()=>{document.removeEventListener('mousemove',onM);document.removeEventListener('mouseup',onU);setTimeout(()=>dragging=false,50);};document.addEventListener('mousemove',onM);document.addEventListener('mouseup',onU);});canvas.addEventListener('wheel',e=>{e.preventDefault();const f=e.deltaY>0?.9:1.1,ns=Math.max(.3,Math.min(3,transform.scale*f));const r=canvas.getBoundingClientRect(),mx=(e.clientX-r.left)*2,my=(e.clientY-r.top)*2;transform.x=mx-(mx-transform.x)*(ns/transform.scale);transform.y=my-(my-transform.y)*(ns/transform.scale);transform.scale=ns;},{passive:false});let ltd=0;canvas.addEventListener('touchstart',e=>{if(e.touches.length===1){dragStart={x:e.touches[0].clientX,y:e.touches[0].clientY};dragTransStart={x:transform.x,y:transform.y};}if(e.touches.length===2)ltd=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);},{passive:true});canvas.addEventListener('touchmove',e=>{if(e.touches.length===1){transform.x=dragTransStart.x+(e.touches[0].clientX-dragStart.x)*2;transform.y=dragTransStart.y+(e.touches[0].clientY-dragStart.y)*2;}if(e.touches.length===2){const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);transform.scale=Math.max(.3,Math.min(3,transform.scale*d/ltd));ltd=d;}},{passive:true});}
  function stw(sx,sy){const r=canvas.getBoundingClientRect();return{x:((sx-r.left)*2-transform.x)/transform.scale,y:((sy-r.top)*2-transform.y)/transform.scale};}

  function openPanel(n){activeNode=n;document.getElementById('npCat').textContent=n.category.toUpperCase();document.getElementById('npName').textContent=n.name;document.getElementById('npTags').textContent=(n.tags||[]).map(t=>'#'+t).join('  ');document.getElementById('npNotes').textContent=n.notes||'';const se=document.getElementById('npSources');se.innerHTML='';const src=n.sources||n.source_emails;if(src&&Array.isArray(src)&&src.length){se.innerHTML='<div class="np-sources-title">SOURCES</div>';src.forEach(s=>{const d=document.createElement('div');d.className='np-source';d.innerHTML=`<div class="np-source-from">${s.from||''}</div><div class="np-source-subject">${s.subject||''}</div><div class="np-source-date">${s.date||''}</div>`;se.appendChild(d);});}const le=document.getElementById('npLinks');le.innerHTML='';if(n.links&&n.links.length){le.innerHTML='<div style="font-size:8px;letter-spacing:1px;color:var(--faint);margin-bottom:4px">CONNECTED TO</div>';n.links.forEach(lid=>{const ln=NX.nodes.find(x=>x.id===lid);if(ln){const d=document.createElement('div');d.textContent='→ '+ln.name;d.style.cssText='padding:5px 0;cursor:pointer;color:var(--accent);font-size:12px';d.onclick=()=>openPanel(ln);le.appendChild(d);}});}document.getElementById('nodePanel').classList.add('open');}
  function closePanel(){activeNode=null;document.getElementById('nodePanel').classList.remove('open');}

  function setupSearch(){const inp=document.getElementById('brainSearch'),res=document.getElementById('searchResults');inp.addEventListener('input',()=>{const q=inp.value.toLowerCase().trim();searchHits=new Set();res.innerHTML='';if(!q){res.classList.remove('open');return;}const m=NX.nodes.filter(n=>!n.is_private&&(n.name.toLowerCase().includes(q)||(n.tags||[]).some(t=>t.includes(q))||(n.notes||'').toLowerCase().includes(q)));m.forEach(n=>searchHits.add(n.id));if(m.length){res.classList.add('open');m.forEach(n=>{const d=document.createElement('div');d.className='sr-item';d.innerHTML=`${n.name}<span>${n.category}</span>`;d.onclick=()=>{openPanel(n);res.classList.remove('open');};res.appendChild(d);});}else res.classList.remove('open');});}

  // List view — opens as DEFAULT
  function setupListView(){
    const btn=document.getElementById('listToggle');
    btn.addEventListener('click',()=>{listViewOpen=!listViewOpen;const lv=document.getElementById('listView');if(listViewOpen){btn.classList.add('on');lv.classList.add('open');buildListFilters();renderList();}else{btn.classList.remove('on');lv.classList.remove('open');}});
    document.querySelectorAll('.sort-btn').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.sort-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');listSortMode=b.dataset.sort;renderList();}));
  }
  function buildListFilters(){const fc=document.getElementById('listFilters');fc.innerHTML='';['all',...new Set(NX.nodes.filter(n=>!n.is_private).map(n=>n.category))].forEach(cat=>{const ch=document.createElement('button');ch.className='filter-chip'+(listFilter===cat?' active':'');ch.textContent=cat==='all'?'All':cat;ch.onclick=()=>{listFilter=cat;buildListFilters();renderList();};fc.appendChild(ch);});}
  function renderList(){const items=document.getElementById('listItems');items.innerHTML='';const q=document.getElementById('brainSearch').value.toLowerCase().trim();let f=NX.nodes.filter(n=>!n.is_private&&(listFilter==='all'||n.category===listFilter)&&(!q||n.name.toLowerCase().includes(q)||(n.tags||[]).some(t=>t.includes(q))||(n.notes||'').toLowerCase().includes(q)));if(listSortMode==='az')f.sort((a,b)=>a.name.localeCompare(b.name));else if(listSortMode==='access')f.sort((a,b)=>(b.access_count||0)-(a.access_count||0));else f.sort((a,b)=>(b.id||0)-(a.id||0));f.forEach(n=>{const el=document.createElement('div');el.className='list-node';el.innerHTML=`<div class="list-node-cat">${n.category}</div><div class="list-node-title">${n.name}</div><div class="list-node-notes">${(n.notes||'').slice(0,120)}</div>`;el.onclick=()=>openPanel(n);items.appendChild(el);});}

  // Contractor events (same, compacted)
  function setupContractorEvents(){document.getElementById('eventsToggle').addEventListener('click',()=>{const p=document.getElementById('eventsPanel');p.classList.toggle('open');if(p.classList.contains('open'))loadEvents();});document.getElementById('eventsClose').addEventListener('click',()=>document.getElementById('eventsPanel').classList.remove('open'));document.getElementById('eventAddBtn').addEventListener('click',addEvent);document.getElementById('eventDate').value=NX.today;const dl=document.getElementById('contractorSuggest');dl.innerHTML='';NX.nodes.filter(n=>n.category==='contractors').forEach(n=>{const o=document.createElement('option');o.value=n.name;dl.appendChild(o);});}
  async function loadEvents(){const l=document.getElementById('eventsList');l.innerHTML='<div style="text-align:center;padding:16px;color:var(--faint);font-size:11px">Loading...</div>';try{const{data}=await NX.sb.from('contractor_events').select('*').gte('event_date',NX.today).order('event_date').order('event_time').limit(30);contractorEvents=data||[];}catch(e){contractorEvents=[];}renderEvents();}
  function renderEvents(){const l=document.getElementById('eventsList');l.innerHTML='';if(!contractorEvents.length){l.innerHTML='<div style="text-align:center;padding:24px;color:var(--muted);font-size:12px;line-height:2">No upcoming visits.</div>';return;}let ld='';contractorEvents.forEach(ev=>{if(ev.event_date!==ld){ld=ev.event_date;const s=document.createElement('div');s.className='event-date-sep'+(ev.event_date===NX.today?' today':'');s.textContent=ev.event_date===NX.today?'TODAY':new Date(ev.event_date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});l.appendChild(s);}const el=document.createElement('div');el.className='event-card';el.innerHTML=`<div class="event-top"><span class="event-contractor">${ev.contractor_name||''}</span><span class="event-time">${ev.event_time?fmt(ev.event_time):''}</span></div><div class="event-desc">${ev.description||''}</div><div class="event-bottom"><span class="event-loc">${ev.location?ev.location[0].toUpperCase()+ev.location.slice(1):''}</span><button class="event-done-btn" data-id="${ev.id}">✓</button><button class="event-del-btn" data-id="${ev.id}">✕</button></div>`;el.querySelector('.event-done-btn').addEventListener('click',async e=>{e.stopPropagation();try{await NX.sb.from('contractor_events').update({status:'done'}).eq('id',e.target.dataset.id);}catch(err){}fs(ev.contractor_name);loadEvents();});el.querySelector('.event-del-btn').addEventListener('click',async e=>{e.stopPropagation();try{await NX.sb.from('contractor_events').delete().eq('id',e.target.dataset.id);}catch(err){}loadEvents();});el.addEventListener('click',()=>fs(ev.contractor_name));l.appendChild(el);});}
  function fmt(t){if(!t)return'';const[h,m]=t.split(':'),hr=+h;return((hr%12)||12)+':'+m+(hr>=12?' PM':' AM');}
  function fs(name){if(!name)return;const cn=NX.nodes.find(n=>n.category==='contractors'&&name.toLowerCase().includes(n.name.toLowerCase().split(' ')[0]));if(cn){activatedNodes=new Set([cn.id,...(cn.links||[])]);setTimeout(()=>{activatedNodes=new Set();},8000);}}
  async function addEvent(){const c=document.getElementById('eventContractor').value.trim(),d=document.getElementById('eventDesc').value.trim(),dt=document.getElementById('eventDate').value,tm=document.getElementById('eventTime').value,loc=document.getElementById('eventLocation').value;if(!c||!dt)return;const b=document.getElementById('eventAddBtn');b.disabled=true;b.textContent='...';try{await NX.sb.from('contractor_events').insert({contractor_name:c,description:d,event_date:dt,event_time:tm||null,location:loc,status:'scheduled'});document.getElementById('eventContractor').value='';document.getElementById('eventDesc').value='';document.getElementById('eventTime').value='';loadEvents();fs(c);}catch(e){}b.disabled=false;b.textContent='+ Schedule';}

  // Suggest to brain (non-admin)
  // HUD collapse
  function setupHudCollapse(){const hud=document.getElementById('chatHud'),chev=document.getElementById('hudChevron');chev.addEventListener('click',()
