/* NEXUS Brain v8 — Optimized for 10k+ nodes */
(function(){
  const canvas=document.getElementById('brainCanvas'),ctx=canvas.getContext('2d');
  let W,H,time=0,particles=[],transform={x:0,y:0,scale:1};
  let dragging=false,dragStart={x:0,y:0},dragTransStart={x:0,y:0};
  let hoverNode=null,activeNode=null,activatedNodes=new Set(),searchHits=new Set();
  let chatHistory=[],voiceOn=false,recognition=null,listViewOpen=false,chatActive=false,contractorEvents=[];
  let listFilter='all',listSortMode='az';
  let physicsFrame=0,physicsSleeping=false,lastInteraction=Date.now();

  if(!localStorage.getItem('nexus_session_id'))localStorage.setItem('nexus_session_id',crypto.randomUUID?crypto.randomUUID():'s_'+Date.now()+'_'+Math.random().toString(36).slice(2));
  const SESSION_ID=localStorage.getItem('nexus_session_id');

  const REP=1200,ATT=0.001,LINK=0.003,CPULL=0.0001,DAMP=0.84,MAXV=4;
  const IDC=250,IDT=140,IDL=120,BR=9,AR=18,SR2=14;
  const CC={location:{r:220,g:186,b:140},equipment:{r:120,g:160,b:210},procedure:{r:140,g:175,b:120},contractors:{r:210,g:148,b:120},vendors:{r:170,g:140,b:210},projects:{r:210,g:190,b:120},systems:{r:120,g:210,b:190},parts:{r:180,g:158,b:158},people:{r:180,g:160,b:210}};
  function cc(cat,a){const c=CC[cat]||CC.equipment;return`rgba(${c.r},${c.g},${c.b},${a})`;}

  const PERSONA=`You are NEXUS, the AI ops brain for Alfredo Ortiz — Suerte, Este, Bar Toti (Austin TX). You have email source references for nodes — cite them when asked "why" or "where from". You remember past conversations. Sharp, concise, warm. Dry wit. Helpful FIRST. EN/ES.`;

  function init(){
    resize();buildParticles();for(let i=0;i<300;i++)physics();
    setupChat();setupSearch();setupCanvas();setupVoice();setupListView();setupContractorEvents();
    checkApiKey();checkEmpty();buildDynamicChips();
    if(localStorage.getItem('nexus_voice_seen')){const l=document.getElementById('micLabel');if(l)l.classList.add('hidden');}
    else localStorage.setItem('nexus_voice_seen','1');
    window.addEventListener('online',()=>{document.getElementById('offlineBanner').style.display='none';});
    window.addEventListener('offline',()=>{document.getElementById('offlineBanner').style.display='block';});
    if(!navigator.onLine)document.getElementById('offlineBanner').style.display='block';
    draw();
  }

  // Resolution capped at 1.5x DPR
  function resize(){
    const r=canvas.getBoundingClientRect();
    const dpr=Math.min(window.devicePixelRatio||1,1.5);
    W=r.width*dpr;H=r.height*dpr;
    canvas.width=W;canvas.height=H;
    canvas.style.width=r.width+'px';canvas.style.height=r.height+'px';
    wakePhysics();
  }
  window.addEventListener('resize',()=>{if(document.getElementById('brainView').classList.contains('active'))resize();});
  function checkApiKey(){const b=document.getElementById('apiBanner');if(b)b.style.display=NX.getApiKey()?'none':'flex';}
  function checkEmpty(){const e=document.getElementById('canvasEmpty');if(e)e.style.display=NX.nodes.length<=1?'flex':'none';}

  function buildDynamicChips(){
    const el=document.getElementById('brainExamples');if(!el)return;el.innerHTML='';
    const top=NX.nodes.filter(n=>!n.is_private).sort((a,b)=>(b.access_count||0)-(a.access_count||0)).slice(0,6);
    const prompts=top.map(n=>{if(n.category==='contractors')return`Who is ${n.name}?`;if(n.category==='equipment')return`${n.name} status?`;if(n.category==='procedure')return`${n.name}?`;return`Tell me about ${n.name}`;});
    if(prompts.length<3)prompts.push('What do you know?','Show me all contractors','Protocolo de limpieza?');
    prompts.slice(0,6).forEach(p=>{const b=document.createElement('button');b.className='brain-ex';b.textContent=p;b.addEventListener('click',()=>{document.getElementById('chatInput').value=p;document.getElementById('chatSend').disabled=false;askAI();});el.appendChild(b);});
  }

  let linkMap={},catMap={},tagSets={};
  function buildParticles(){
    const nodes=NX.nodes.filter(n=>!n.is_private),cx=W/2,cy=H/2;
    const cats=[...new Set(nodes.map(n=>n.category))],ca={};cats.forEach((c,i)=>{ca[c]=(i/cats.length)*Math.PI*2;});
    particles=nodes.map(n=>{const b=ca[n.category]||0,j=(Math.random()-0.5)*1.2,d=300+Math.random()*900;return{id:n.id,x:cx+Math.cos(b+j)*d,y:cy+Math.sin(b+j)*d,vx:0,vy:0,node:n,cat:n.category,tags:n.tags||[],links:n.links||[],access:n.access_count||1};});
    linkMap={};catMap={};tagSets={};
    particles.forEach((p,i)=>{linkMap[p.id]=p;if(!catMap[p.cat])catMap[p.cat]=[];catMap[p.cat].push(i);tagSets[i]=new Set(p.tags);});
  }

  // Wake physics on interaction
  function wakePhysics(){physicsSleeping=false;lastInteraction=Date.now();}

  // ═══ PHYSICS — optimized with integer grid, sleep detection ═══
  function physics(){
    if(physicsSleeping)return;
    const len=particles.length,cx=W/2,cy=H/2,ih=hoverNode!==null;
    const CELL=200,grid=new Map();
    let totalEnergy=0;

    // Build grid with integer keys
    for(let i=0;i<len;i++){
      const a=particles[i];
      const key=((Math.floor(a.x/CELL)+500)<<16)|(Math.floor(a.y/CELL)+500);
      let cell=grid.get(key);if(!cell){cell=[];grid.set(key,cell);}cell.push(i);
    }

    for(let i=0;i<len;i++){
      const a=particles[i];
      if(ih&&Math.hypot(a.x-hoverNode.x,a.y-hoverNode.y)<100){a.vx*=0.05;a.vy*=0.05;continue;}
      const gx=Math.floor(a.x/CELL)+500,gy=Math.floor(a.y/CELL)+500;

      // Repulsion (grid neighbors only)
      for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++){
        const nb=grid.get(((gx+ox)<<16)|(gy+oy));if(!nb)continue;
        for(let ni=0;ni<nb.length;ni++){const j=nb[ni];if(j<=i)continue;
          const b=particles[j];let dx=a.x-b.x,dy=a.y-b.y,dS=dx*dx+dy*dy;
          if(dS>160000)continue;let d=Math.sqrt(dS)||1,f=REP/dS;
          a.vx+=dx/d*f;a.vy+=dy/d*f;b.vx-=dx/d*f;b.vy-=dy/d*f;
        }
      }

      // Category attraction (sample max 30 per category for perf)
      const sc=catMap[a.cat];
      if(sc){const step=sc.length>30?Math.ceil(sc.length/30):1;
        for(let ci=0;ci<sc.length;ci+=step){const j=sc[ci];if(j===i)continue;
          const b=particles[j];let dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1;
          a.vx+=dx/d*(d-IDC)*ATT;a.vy+=dy/d*(d-IDC)*ATT;
        }
      }

      // Tag attraction (skip if too many nodes — sample grid)
      const aT=tagSets[i];
      if(aT&&aT.size>0){
        for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++){
          const nb=grid.get(((gx+ox)<<16)|(gy+oy));if(!nb)continue;
          for(let ni=0;ni<nb.length;ni++){const j=nb[ni];if(j===i)continue;
            const bT=tagSets[j];if(!bT)continue;let sh=0;
            for(const t of aT)if(bT.has(t))sh++;if(!sh)continue;
            const b=particles[j];let dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1;
            a.vx+=dx/d*(d-IDT)*ATT*sh*1.2;a.vy+=dy/d*(d-IDT)*ATT*sh*1.2;
          }
        }
      }

      // Link attraction
      for(let li=0;li<a.links.length;li++){const b=linkMap[a.links[li]];if(!b)continue;
        let dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1;
        a.vx+=dx/d*(d-IDL)*LINK;a.vy+=dy/d*(d-IDL)*LINK;
      }

      // Center pull
      const nA=Math.min(a.access/60,1);
      a.vx+=(cx-a.x)*CPULL*(0.3+nA*0.7);a.vy+=(cy-a.y)*CPULL*(0.3+nA*0.7);

      // Center beacon repulsion — wider no-go zone
      const cdist=Math.sqrt((a.x-cx)*(a.x-cx)+(a.y-cy)*(a.y-cy))||1;
      if(cdist<160){const cf=(160-cdist)*0.1;a.vx+=(a.x-cx)/cdist*cf;a.vy+=(a.y-cy)/cdist*cf;}

      // Orbital rotation — stronger, consistent
      const orbitSpeed=0.2/(1+cdist*0.002);
      a.vx+=-(a.y-cy)/cdist*orbitSpeed;a.vy+=(a.x-cx)/cdist*orbitSpeed;

      a.vx*=DAMP;a.vy*=DAMP;
      const sp=a.vx*a.vx+a.vy*a.vy;
      if(sp>MAXV*MAXV){const s=Math.sqrt(sp);a.vx=a.vx/s*MAXV;a.vy=a.vy/s*MAXV;}
      totalEnergy+=sp;
      a.x+=a.vx;a.y+=a.vy;
      if(a.x<80)a.vx+=1;if(a.x>W-80)a.vx-=1;if(a.y<80)a.vy+=1;if(a.y>H-80)a.vy-=1;
    }

    // Sleep if settled and no recent interaction
    if(totalEnergy<len*0.01&&Date.now()-lastInteraction>5000)physicsSleeping=true;
  }

  // ═══ RENDER — optimized: no shadowBlur on normal nodes, LOD, culling ═══
  function draw(){
    time+=0.008;
    physicsFrame++;
    // Run physics every 2nd frame when >500 nodes
    if(particles.length<500||physicsFrame%2===0)physics();

    ctx.save();ctx.fillStyle='#121214';ctx.fillRect(0,0,W,H);
    ctx.translate(transform.x,transform.y);ctx.scale(transform.scale,transform.scale);
    const cx=W/2,cy=H/2,isA=activatedNodes.size>0;
    const invScale=1/transform.scale;
    // Viewport bounds in world coords
    const vl=-transform.x*invScale-100,vr=(-transform.x+W)*invScale+100;
    const vt=-transform.y*invScale-100,vb=(-transform.y+H)*invScale+100;

    // Connection lines — straight lines for normal, curves only for hot
    ctx.lineWidth=1.2;
    ctx.strokeStyle='rgba(212,182,138,.25)';
    ctx.beginPath();
    for(let i=0;i<particles.length;i++){
      const a=particles[i];if(a.x<vl||a.x>vr||a.y<vt||a.y>vb)continue;
      for(let li=0;li<a.links.length;li++){
        const b=linkMap[a.links[li]];if(!b)continue;
        const hot=(activatedNodes.has(a.id)&&activatedNodes.has(b.id))||(searchHits.has(a.id)&&searchHits.has(b.id));
        if(hot)continue; // draw hot ones separately
        ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
      }
    }
    ctx.stroke();

    // Hot connection lines (with curves + particles)
    for(let i=0;i<particles.length;i++){
      const a=particles[i];
      for(let li=0;li<a.links.length;li++){
        const b=linkMap[a.links[li]];if(!b)continue;
        const hot=(activatedNodes.has(a.id)&&activatedNodes.has(b.id))||(searchHits.has(a.id)&&searchHits.has(b.id));
        if(!hot)continue;
        const mx=(a.x+b.x)/2+Math.sin(time*.5+a.id)*5,my=(a.y+b.y)/2+Math.cos(time*.4)*5;
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.quadraticCurveTo(mx,my,b.x,b.y);
        ctx.strokeStyle=cc(a.cat,.7);ctx.lineWidth=3;ctx.stroke();
      }
    }

    // Center lines — only top 30 most accessed + active/hit nodes
    ctx.lineWidth=0.5;ctx.strokeStyle='rgba(212,182,138,.06)';ctx.beginPath();
    for(let i=0;i<particles.length;i++){
      const a=particles[i];
      const hit=searchHits.has(a.id)||activatedNodes.has(a.id);
      const show=hit||a.access>10;
      if(!show)continue;
      if(hit){ctx.stroke();ctx.beginPath();ctx.strokeStyle=`rgba(212,182,138,.3)`;ctx.lineWidth=1.2;ctx.moveTo(cx,cy);ctx.lineTo(a.x,a.y);ctx.stroke();ctx.beginPath();ctx.strokeStyle='rgba(212,182,138,.06)';ctx.lineWidth=0.5;}
      else{ctx.moveTo(cx,cy);ctx.lineTo(a.x,a.y);}
    }
    ctx.stroke();

    // Center beacon
    const br=Math.sin(time*1.1),pr=55+br*5;
    ctx.shadowBlur=40;ctx.shadowColor='rgba(212,182,138,.6)';
    ctx.beginPath();ctx.arc(cx,cy,pr,0,Math.PI*2);ctx.fillStyle='#18181c';ctx.fill();
    ctx.strokeStyle=`rgba(212,182,138,${.6+br*.2})`;ctx.lineWidth=2.5;ctx.stroke();
    ctx.shadowBlur=0;
    ctx.fillStyle=`rgba(212,182,138,${.85+br*.1})`;ctx.font='600 18px JetBrains Mono';ctx.textAlign='center';ctx.fillText('NEXUS',cx,cy+6);

    // Nodes — NO shadowBlur on normal nodes, only on active/hit
    for(let i=0;i<particles.length;i++){
      const a=particles[i];
      // Viewport culling
      if(a.x<vl||a.x>vr||a.y<vt||a.y>vb)continue;

      const hit=searchHits.has(a.id)||activatedNodes.has(a.id);
      const act=activeNode&&activeNode.id===a.id;
      const dim=isA&&!hit&&!act;
      const p=Math.sin(time*1.5+a.id*.6);
      const nr=act?AR+p*2:hit?SR2+p*1.5:dim?4:BR+p*.4;

      // shadowBlur ONLY for active/hit nodes (max ~10)
      if(hit||act){ctx.shadowBlur=16;ctx.shadowColor=cc(a.cat,.8);}

      ctx.beginPath();ctx.arc(a.x,a.y,nr,0,Math.PI*2);
      ctx.fillStyle=cc(a.cat,act?.95:hit?.8:dim?.08:.55);
      ctx.fill();
      ctx.strokeStyle=cc(a.cat,act?.7:hit?.55:dim?.04:.25);
      ctx.lineWidth=act?2:0.8;ctx.stroke();

      if(hit||act)ctx.shadowBlur=0;

      // LOD labels — skip if too small on screen
      const sr=nr*transform.scale;
      if(sr<4&&!hit&&!act)continue;
      if(dim)continue; // skip labels for dimmed nodes

      const label=a.node.name.length>20?a.node.name.slice(0,18)+'…':a.node.name;
      const la=act?.95:hit?.9:.5;
      ctx.font=`${act?'500 ':'300 '}${sr>8?'11':'9'}px "Libre Franklin"`;
      ctx.textAlign='center';
      const tx=a.x,ty=a.y-nr-6;
      ctx.fillStyle=`rgba(236,233,225,${la})`;
      ctx.fillText(label,tx,ty+3,200);
    }

    ctx.restore();requestAnimationFrame(draw);
  }

  // ═══ CANVAS INTERACTION ═══
  function setupCanvas(){
    canvas.addEventListener('click',e=>{if(dragging)return;wakePhysics();const p=stw(e.clientX,e.clientY);let cl=null,cd=35/transform.scale;particles.forEach(a=>{const d=Math.hypot(p.x-a.x,p.y-a.y);if(d<cd){cl=a;cd=d;}});if(cl)openPanel(cl.node);else closePanel();});
    canvas.addEventListener('mousemove',e=>{if(dragging)return;const p=stw(e.clientX,e.clientY);hoverNode=null;particles.forEach(a=>{if(Math.hypot(p.x-a.x,p.y-a.y)<25/transform.scale)hoverNode=a;});canvas.style.cursor=hoverNode?'pointer':'crosshair';if(hoverNode)wakePhysics();});
    canvas.addEventListener('mousedown',e=>{if(e.button!==0)return;dragging=false;dragStart={x:e.clientX,y:e.clientY};dragTransStart={x:transform.x,y:transform.y};const onM=ev=>{const dx=ev.clientX-dragStart.x,dy=ev.clientY-dragStart.y;if(Math.abs(dx)+Math.abs(dy)>5)dragging=true;const dpr=Math.min(window.devicePixelRatio||1,1.5);transform.x=dragTransStart.x+dx*dpr;transform.y=dragTransStart.y+dy*dpr;};const onU=()=>{document.removeEventListener('mousemove',onM);document.removeEventListener('mouseup',onU);setTimeout(()=>dragging=false,50);};document.addEventListener('mousemove',onM);document.addEventListener('mouseup',onU);});
    canvas.addEventListener('wheel',e=>{e.preventDefault();wakePhysics();const f=e.deltaY>0?.9:1.1,ns=Math.max(.2,Math.min(4,transform.scale*f));const r=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,1.5),mx=(e.clientX-r.left)*dpr,my=(e.clientY-r.top)*dpr;transform.x=mx-(mx-transform.x)*(ns/transform.scale);transform.y=my-(my-transform.y)*(ns/transform.scale);transform.scale=ns;},{passive:false});
    let ltd=0;
    canvas.addEventListener('touchstart',e=>{wakePhysics();if(e.touches.length===1){dragStart={x:e.touches[0].clientX,y:e.touches[0].clientY};dragTransStart={x:transform.x,y:transform.y};}if(e.touches.length===2)ltd=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);},{passive:true});
    canvas.addEventListener('touchmove',e=>{const dpr=Math.min(window.devicePixelRatio||1,1.5);if(e.touches.length===1){transform.x=dragTransStart.x+(e.touches[0].clientX-dragStart.x)*dpr;transform.y=dragTransStart.y+(e.touches[0].clientY-dragStart.y)*dpr;}if(e.touches.length===2){const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);transform.scale=Math.max(.2,Math.min(4,transform.scale*d/ltd));ltd=d;}},{passive:true});
  }
  function stw(sx,sy){const r=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,1.5);return{x:((sx-r.left)*dpr-transform.x)/transform.scale,y:((sy-r.top)*dpr-transform.y)/transform.scale};}

  // ═══ NODE PANEL ═══
  function openPanel(n){activeNode=n;wakePhysics();document.getElementById('npCat').textContent=n.category.toUpperCase();document.getElementById('npName').textContent=n.name;document.getElementById('npTags').textContent=(n.tags||[]).map(t=>'#'+t).join('  ');document.getElementById('npNotes').textContent=n.notes||'';const se=document.getElementById('npSources');se.innerHTML='';const src=n.sources||n.source_emails;if(src&&Array.isArray(src)&&src.length){se.innerHTML='<div class="np-sources-title">SOURCES</div>';src.forEach(s=>{const d=document.createElement('div');d.className='np-source';d.innerHTML=`<div class="np-source-from">${s.from||''}</div><div class="np-source-subject">${s.subject||''}</div><div class="np-source-date">${s.date||''}</div>`;se.appendChild(d);});}const le=document.getElementById('npLinks');le.innerHTML='';if(n.links&&n.links.length){le.innerHTML='<div style="font-size:8px;letter-spacing:1px;color:var(--faint);margin-bottom:4px">CONNECTED TO</div>';n.links.forEach(lid=>{const ln=NX.nodes.find(x=>x.id===lid);if(ln){const d=document.createElement('div');d.textContent='→ '+ln.name;d.style.cssText='padding:5px 0;cursor:pointer;color:var(--accent);font-size:12px';d.onclick=()=>openPanel(ln);le.appendChild(d);}});}document.getElementById('nodePanel').classList.add('open');}
  function closePanel(){activeNode=null;document.getElementById('nodePanel').classList.remove('open');}

  // ═══ SEARCH ═══
  function setupSearch(){const inp=document.getElementById('brainSearch'),res=document.getElementById('searchResults');inp.addEventListener('input',()=>{wakePhysics();const q=inp.value.toLowerCase().trim();searchHits=new Set();res.innerHTML='';if(!q){res.classList.remove('open');return;}const m=NX.nodes.filter(n=>!n.is_private&&(n.name.toLowerCase().includes(q)||(n.tags||[]).some(t=>t.includes(q))||(n.notes||'').toLowerCase().includes(q)));m.forEach(n=>searchHits.add(n.id));if(m.length){res.classList.add('open');m.slice(0,20).forEach(n=>{const d=document.createElement('div');d.className='sr-item';d.innerHTML=`${n.name}<span>${n.category}</span>`;d.onclick=()=>{openPanel(n);res.classList.remove('open');};res.appendChild(d);});}else res.classList.remove('open');});}

  // ═══ LIST VIEW ═══
  function setupListView(){
    document.getElementById('listToggle').addEventListener('click',()=>{listViewOpen=!listViewOpen;const lv=document.getElementById('listView'),btn=document.getElementById('listToggle');if(listViewOpen){btn.classList.add('on');lv.classList.add('open');buildListFilters();renderList();}else{btn.classList.remove('on');lv.classList.remove('open');}});
    document.querySelectorAll('.sort-btn').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.sort-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');listSortMode=b.dataset.sort;renderList();}));
  }
  function buildListFilters(){const fc=document.getElementById('listFilters');fc.innerHTML='';['all',...new Set(NX.nodes.filter(n=>!n.is_private).map(n=>n.category))].forEach(cat=>{const ch=document.createElement('button');ch.className='filter-chip'+(listFilter===cat?' active':'');ch.textContent=cat==='all'?'All':cat;ch.onclick=()=>{listFilter=cat;buildListFilters();renderList();};fc.appendChild(ch);});}
  function renderList(){const items=document.getElementById('listItems');items.innerHTML='';const q=document.getElementById('brainSearch').value.toLowerCase().trim();let f=NX.nodes.filter(n=>!n.is_private&&(listFilter==='all'||n.category===listFilter)&&(!q||n.name.toLowerCase().includes(q)||(n.tags||[]).some(t=>t.includes(q))||(n.notes||'').toLowerCase().includes(q)));if(listSortMode==='az')f.sort((a,b)=>a.name.localeCompare(b.name));else if(listSortMode==='access')f.sort((a,b)=>(b.access_count||0)-(a.access_count||0));else f.sort((a,b)=>(b.id||0)-(a.id||0));f.slice(0,200).forEach(n=>{const el=document.createElement('div');el.className='list-node';el.innerHTML=`<div class="list-node-cat">${n.category}</div><div class="list-node-title">${n.name}</div><div class="list-node-notes">${(n.notes||'').slice(0,120)}</div>`;el.onclick=()=>openPanel(n);items.appendChild(el);});}

  // ═══ CONTRACTOR EVENTS ═══
  function setupContractorEvents(){document.getElementById('eventsToggle').addEventListener('click',()=>{const p=document.getElementById('eventsPanel');p.classList.toggle('open');if(p.classList.contains('open'))loadEvents();});document.getElementById('eventsClose').addEventListener('click',()=>document.getElementById('eventsPanel').classList.remove('open'));document.getElementById('eventAddBtn').addEventListener('click',addEvent);document.getElementById('eventDate').value=NX.today;const dl=document.getElementById('contractorSuggest');dl.innerHTML='';NX.nodes.filter(n=>n.category==='contractors').forEach(n=>{const o=document.createElement('option');o.value=n.name;dl.appendChild(o);});}
  async function loadEvents(){const l=document.getElementById('eventsList');l.innerHTML='<div style="text-align:center;padding:16px;color:var(--faint);font-size:11px">Loading...</div>';try{const{data}=await NX.sb.from('contractor_events').select('*').gte('event_date',NX.today).order('event_date').order('event_time').limit(30);contractorEvents=data||[];}catch(e){contractorEvents=[];}renderEvents();}
  function renderEvents(){const l=document.getElementById('eventsList');l.innerHTML='';if(!contractorEvents.length){l.innerHTML='<div style="text-align:center;padding:24px;color:var(--muted);font-size:12px;line-height:2">No upcoming visits.</div>';return;}let ld='';contractorEvents.forEach(ev=>{if(ev.event_date!==ld){ld=ev.event_date;const s=document.createElement('div');s.className='event-date-sep'+(ev.event_date===NX.today?' today':'');s.textContent=ev.event_date===NX.today?'TODAY':new Date(ev.event_date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});l.appendChild(s);}const el=document.createElement('div');el.className='event-card';el.innerHTML=`<div class="event-top"><span class="event-contractor">${ev.contractor_name||''}</span><span class="event-time">${ev.event_time?fmt(ev.event_time):''}</span></div><div class="event-desc">${ev.description||''}</div><div class="event-bottom"><span class="event-loc">${ev.location?ev.location[0].toUpperCase()+ev.location.slice(1):''}</span><button class="event-done-btn" data-id="${ev.id}">✓</button><button class="event-del-btn" data-id="${ev.id}">✕</button></div>`;el.querySelector('.event-done-btn').addEventListener('click',async e=>{e.stopPropagation();try{await NX.sb.from('contractor_events').update({status:'done'}).eq('id',e.target.dataset.id);}catch(err){}fs(ev.contractor_name);loadEvents();});el.querySelector('.event-del-btn').addEventListener('click',async e=>{e.stopPropagation();try{await NX.sb.from('contractor_events').delete().eq('id',e.target.dataset.id);}catch(err){}loadEvents();});el.addEventListener('click',()=>fs(ev.contractor_name));l.appendChild(el);});}
  function fmt(t){if(!t)return'';const[h,m]=t.split(':'),hr=+h;return((hr%12)||12)+':'+m+(hr>=12?' PM':' AM');}
  function fs(name){if(!name)return;wakePhysics();const cn=NX.nodes.find(n=>n.category==='contractors'&&name.toLowerCase().includes(n.name.toLowerCase().split(' ')[0]));if(cn){activatedNodes=new Set([cn.id,...(cn.links||[])]);setTimeout(()=>{activatedNodes=new Set();},8000);}}
  async function addEvent(){const c=document.getElementById('eventContractor').value.trim(),d=document.getElementById('eventDesc').value.trim(),dt=document.getElementById('eventDate').value,tm=document.getElementById('eventTime').value,loc=document.getElementById('eventLocation').value;if(!c||!dt)return;const b=document.getElementById('eventAddBtn');b.disabled=true;b.textContent='...';try{await NX.sb.from('contractor_events').insert({contractor_name:c,description:d,event_date:dt,event_time:tm||null,location:loc,status:'scheduled'});document.getElementById('eventContractor').value='';document.getElementById('eventDesc').value='';document.getElementById('eventTime').value='';loadEvents();fs(c);}catch(e){}b.disabled=false;b.textContent='+ Schedule';}

  // ═══ CHAT ═══
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
  }
  function resetChat(){chatHistory=[];chatActive=false;document.getElementById('chatMessages').innerHTML='';document.getElementById('brainWelcome').style.display='';document.getElementById('brainExamples').style.display='';document.getElementById('brainDim').classList.remove('active');document.getElementById('resetBtn').style.display='none';activatedNodes=new Set();wakePhysics();}

  async function getCtx(q){const w=q.toLowerCase().split(/\s+/).filter(x=>x.length>2);const sc=NX.nodes.map(n=>{let s=0;const t=(n.name+' '+n.category+' '+(n.tags||[]).join(' ')+' '+(n.notes||'')).toLowerCase();w.forEach(x=>{if(t.includes(x))s+=t.split(x).length-1;});if(n.name.toLowerCase().includes(q.toLowerCase()))s+=10;return{node:n,score:s};}).filter(s=>s.score>0).sort((a,b)=>b.score-a.score);const rel=sc.slice(0,10).map(s=>s.node);const idx=NX.nodes.filter(n=>!n.is_private).map(n=>`${n.name} (${n.category})`).join(', ');const det=rel.map(n=>{let src='';const sources=n.sources||n.source_emails;if(sources&&sources.length)src=' [Sources: '+sources.map(s=>`${s.from} "${s.subject}" ${s.date}`).join('; ')+']';return`[${n.category}] ${n.name}: ${n.notes}${src}`;}).join('\n');const relIds=rel.map(n=>n.id);activatedNodes=new Set(relIds);wakePhysics();setTimeout(()=>{activatedNodes=new Set();},12000);NX.trackAccess(relIds);const memory=await NX.fetchMemory(q);let ev='';if(contractorEvents.length)ev='\n\nUPCOMING:\n'+contractorEvents.slice(0,8).map(e=>`${e.contractor_name} @ ${e.location||'?'} ${e.event_date}`).join('\n');return`RELEVANT NODES:\n${det}\n\nINDEX (${NX.nodes.length}):\n${idx}${memory}${ev}`;}

  async function askAI(){
    if(!navigator.onLine){addB("Can't reach NEXUS — check WiFi.",'ai');return;}
    const i=document.getElementById('chatInput'),q=i.value.trim();if(!q)return;
    i.value='';document.getElementById('chatSend').disabled=true;document.getElementById('brainWelcome').style.display='none';document.getElementById('brainExamples').style.display='none';document.getElementById('brainDim').classList.add('active');document.getElementById('chatHud').classList.add('expanded');document.getElementById('chatHud').classList.remove('collapsed');document.getElementById('resetBtn').style.display='';chatActive=true;addB(q,'user');chatHistory.push({role:'user',content:q});
    if(!NX.getApiKey()){addB('No API key set — open Admin ⚙ to add your Anthropic key.','ai');return;}
    const task=detectTask(q);if(task){
      if(task.type==='research'){try{await handleResearch(task.content);}catch(e){addB('Research error: '+e.message,'ai');}return;}
      try{const result=await handleTask(task);if(result){addB(result,'ai');chatHistory.push({role:'assistant',content:result});if(voiceOn)speak(result);try{await NX.sb.from('chat_history').insert({question:q,answer:result,session_id:SESSION_ID});}catch(e){}return;}}catch(e){addB('Task error: '+e.message,'ai');return;}}
    const th=addB(`Searching ${NX.nodes.length} nodes...`,'ai thinking');
    try{
      const ctx=await getCtx(q);
      const msgs=chatHistory.slice(-6).map(m=>({role:m.role==='user'?'user':'assistant',content:m.content}));
      const ans=await NX.askClaude(PERSONA+'\n\n'+ctx,msgs,800,false);
      th.textContent=ans||'No response received.';th.classList.remove('chat-thinking');
      chatHistory.push({role:'assistant',content:ans});
      if(voiceOn)speak(ans);
      try{await NX.sb.from('chat_history').insert({question:q,answer:ans,session_id:SESSION_ID});}catch(e){}
    }catch(e){
      th.textContent='Error: '+(e.message||'Unknown error');th.classList.remove('chat-thinking');
    }
  }
  function addB(t,type){const el=document.createElement('div');el.className='chat-bubble chat-'+(type.includes('user')?'user':'ai');if(type.includes('thinking'))el.classList.add('chat-thinking');el.textContent=t;el.style[type.includes('user')?'marginLeft':'marginRight']='auto';const c=document.getElementById('chatMessages');c.appendChild(el);c.scrollTop=c.scrollHeight;return el;}

  // ═══ VOICE ═══
  let pv=null;const VOICES=[{id:'pNInz6obpgDQGcFmaJgB',name:'Adam',desc:'Sharp & confident'},{id:'EXAVITQu4vr4xnSDxMaL',name:'Bella',desc:'Warm & witty'},{id:'onwK4e9ZLuTAKqWW03F9',name:'Daniel',desc:'British dry wit'},{id:'XB0fDUnXU5powFXDhCwa',name:'Charlotte',desc:'Smart & smooth'},{id:'TX3LPaxmHKxFdv7VOQHJ',name:'Liam',desc:'Casual & quick'},{id:'jBpfuIE2acCO8z3wKNLl',name:'Emily',desc:'Friendly & clear'},{id:'yoZ06aMxZJJ28mfd3POQ',name:'Sam',desc:'Deep & calm'},{id:'ThT5KcBeYPX3keUQqHPh',name:'Dorothy',desc:'Warm storyteller'},{id:'VR6AewLTigWG4xSOukaG',name:'Arnold',desc:'Bold & direct'},{id:'pqHfZKP75CvOlQylNhV4',name:'Bill',desc:'Natural & relaxed'}];
  let cvi=parseInt(localStorage.getItem('nexus_voice_idx')||'0')%VOICES.length;
  function setupVoice(){document.getElementById('micBtn').addEventListener('click',toggleMic);const vb=document.getElementById('voiceBtn');let pt=null;vb.addEventListener('click',()=>{voiceOn=!voiceOn;vb.classList.toggle('on',voiceOn);if(voiceOn)vb.title=`Voice: ${VOICES[cvi].name}`;});vb.addEventListener('pointerdown',()=>{pt=setTimeout(()=>{cvi=(cvi+1)%VOICES.length;localStorage.setItem('nexus_voice_idx',cvi);voiceOn=true;vb.classList.add('on');vb.title=`Voice: ${VOICES[cvi].name}`;speak(`${VOICES[cvi].name} here. ${VOICES[cvi].desc}.`);pt=null;},600);});vb.addEventListener('pointerup',()=>{if(pt)clearTimeout(pt);});vb.addEventListener('pointerleave',()=>{if(pt)clearTimeout(pt);});if('speechSynthesis'in window){const pk=()=>{const v=speechSynthesis.getVoices();for(const n of['Samantha','Karen','Daniel','Microsoft Aria']){const f=v.find(x=>x.name.includes(n));if(f){pv=f;break;}}};pk();speechSynthesis.onvoiceschanged=pk;}}
  function toggleMic(){const b=document.getElementById('micBtn');if(recognition){recognition.stop();recognition=null;b.classList.remove('recording');return;}if(!('webkitSpeechRecognition'in window||'SpeechRecognition'in window))return;const SR=window.SpeechRecognition||window.webkitSpeechRecognition;recognition=new SR();recognition.continuous=false;recognition.interimResults=false;recognition.onresult=e=>{document.getElementById('chatInput').value=e.results[0][0].transcript;document.getElementById('chatSend').disabled=false;b.classList.remove('recording');recognition=null;askAI();};recognition.onerror=()=>{b.classList.remove('recording');recognition=null;};recognition.onend=()=>{b.classList.remove('recording');recognition=null;};b.classList.add('recording');recognition.start();}
  async function speak(text){const ek=NX.getElevenLabsKey();if(ek){try{const r=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICES[cvi].id}`,{method:'POST',headers:{'Content-Type':'application/json','xi-api-key':ek},body:JSON.stringify({text:text.slice(0,800),model_id:'eleven_turbo_v2',voice_settings:{stability:.45,similarity_boost:.78,style:.35,use_speaker_boost:true}})});if(r.ok){const bl=await r.blob(),u=URL.createObjectURL(bl),a=new Audio(u);a.play();a.onended=()=>URL.revokeObjectURL(u);return;}}catch(e){}}if(!('speechSynthesis'in window))return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text.slice(0,600));if(pv)u.voice=pv;u.rate=.95;speechSynthesis.speak(u);}

  NX.brain={init,closePanel,show:()=>{resize();}};NX.modules.brain=NX.brain;NX.loaded.brain=true;
})();
