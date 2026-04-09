/* ═══════════════════════════════════════════
   NEXUS — Brain v5.1
   FULL-SCREEN canvas restored. Source citations.
   Calm physics, voice picker, list filters.
   ═══════════════════════════════════════════ */
(function () {
  const canvas = document.getElementById('brainCanvas');
  const ctx = canvas.getContext('2d');

  let W, H, animId, time = 0;
  let particles = [], transform = { x: 0, y: 0, scale: 1 };
  let dragging = false, dragStart = {x:0,y:0}, dragTransStart = {x:0,y:0};
  let hoverNode = null, activeNode = null;
  let activatedNodes = new Set(), searchHits = new Set();
  let chatHistory = [], voiceOn = false, recognition = null;
  let listViewOpen = false, chatActive = false, contractorEvents = [];
  let listFilter = 'all', listSortMode = 'az';

  const REPULSION=500, ATTRACTION=0.0015, LINK_STRENGTH=0.004, CENTER_PULL=0.00025;
  const DAMPING=0.84, MAX_VEL=4;
  const IDEAL_CAT_DIST=160, IDEAL_TAG_DIST=110, IDEAL_LINK_DIST=90;
  const BASE_RADIUS=9, ACTIVE_RADIUS=18, SYNAPSE_RADIUS=14;

  const CAT_COLORS = {
    location:{r:220,g:186,b:140}, equipment:{r:120,g:160,b:210}, procedure:{r:140,g:175,b:120},
    contractors:{r:210,g:148,b:120}, vendors:{r:170,g:140,b:210}, projects:{r:210,g:190,b:120},
    systems:{r:120,g:210,b:190}, parts:{r:180,g:158,b:158}, people:{r:180,g:160,b:210}
  };
  function cc(cat,a){const c=CAT_COLORS[cat]||CAT_COLORS.equipment;return`rgba(${c.r},${c.g},${c.b},${a})`;}

  const PERSONA=`You are NEXUS, the AI operations brain for Alfredo Ortiz — Suerte, Este, Bar Toti (Austin TX).
You have access to email source references for nodes. When asked "why did we buy X" or "where did this come from", cite the source email (from, subject, date).
Sharp, concise, warm. Dry wit. Helpful FIRST. Respond in EN or ES. CONCISE.`;

  function init(){resize();buildParticles();warmStart();setupChat();setupSearch();setupCanvas();setupVoice();setupListView();setupContractorEvents();checkApiKey();draw();}

  function resize(){const r=canvas.parentElement.getBoundingClientRect();W=r.width*2;H=r.height*2;canvas.width=W;canvas.height=H;}
  window.addEventListener('resize',()=>{if(document.getElementById('brainView').classList.contains('active'))resize();});
  function checkApiKey(){const b=document.getElementById('apiBanner');if(b)b.style.display=NX.getApiKey()?'none':'flex';}

  let linkMap={},catMap={},tagSets={};
  function buildParticles(){
    const nodes=NX.nodes.filter(n=>!n.is_private),cx=W/2,cy=H/2;
    const cats=[...new Set(nodes.map(n=>n.category))],ca={};cats.forEach((c,i)=>{ca[c]=(i/cats.length)*Math.PI*2;});
    particles=nodes.map(n=>{const b=ca[n.category]||0,j=(Math.random()-0.5)*1.4,d=200+Math.random()*500;
      return{id:n.id,x:cx+Math.cos(b+j)*d,y:cy+Math.sin(b+j)*d,vx:0,vy:0,node:n,cat:n.category,tags:n.tags||[],links:n.links||[],access:n.access_count||1};});
    linkMap={};catMap={};tagSets={};
    particles.forEach((p,i)=>{linkMap[p.id]=p;if(!catMap[p.cat])catMap[p.cat]=[];catMap[p.cat].push(i);tagSets[i]=new Set(p.tags);});
  }
  function warmStart(){for(let i=0;i<300;i++)physics();}

  function physics(){
    const len=particles.length,cx=W/2,cy=H/2,ih=hoverNode!==null;
    const CELL=200,grid={};
    for(let i=0;i<len;i++){const a=particles[i],k=Math.floor(a.x/CELL)+','+Math.floor(a.y/CELL);if(!grid[k])grid[k]=[];grid[k].push(i);}
    for(let i=0;i<len;i++){
      const a=particles[i];
      if(ih&&Math.hypot(a.x-hoverNode.x,a.y-hoverNode.y)<100){a.vx*=0.05;a.vy*=0.05;continue;}
      const gx=Math.floor(a.x/CELL),gy=Math.floor(a.y/CELL);
      for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++){const nb=grid[(gx+ox)+','+(gy+oy)];if(!nb)continue;for(let ni=0;ni<nb.length;ni++){const j=nb[ni];if(j<=i)continue;const b=particles[j];let dx=a.x-b.x,dy=a.y-b.y,dSq=dx*dx+dy*dy;if(dSq>160000)continue;let d=Math.sqrt(dSq)||1,f=REPULSION/dSq,fx=dx/d*f,fy=dy/d*f;a.vx+=fx;a.vy+=fy;b.vx-=fx;b.vy-=fy;}}
      const sc=catMap[a.cat];if(sc)for(let ci=0;ci<sc.length;ci++){const j=sc[ci];if(j===i)continue;const b=particles[j];let dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1;a.vx+=dx/d*(d-IDEAL_CAT_DIST)*ATTRACTION;a.vy+=dy/d*(d-IDEAL_CAT_DIST)*ATTRACTION;}
      const aTS=tagSets[i];if(aTS&&aTS.size>0)for(let ox=-2;ox<=2;ox++)for(let oy=-2;oy<=2;oy++){const nb=grid[(gx+ox)+','+(gy+oy)];if(!nb)continue;for(let ni=0;ni<nb.length;ni++){const j=nb[ni];if(j===i)continue;const bTS=tagSets[j];if(!bTS)continue;let sh=0;for(const t of aTS)if(bTS.has(t))sh++;if(!sh)continue;const b=particles[j];let dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1;a.vx+=dx/d*(d-IDEAL_TAG_DIST)*ATTRACTION*sh*1.2;a.vy+=dy/d*(d-IDEAL_TAG_DIST)*ATTRACTION*sh*1.2;}}
      a.links.forEach(lid=>{const b=linkMap[lid];if(!b)return;let dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1;a.vx+=dx/d*(d-IDEAL_LINK_DIST)*LINK_STRENGTH;a.vy+=dy/d*(d-IDEAL_LINK_DIST)*LINK_STRENGTH;});
      const nA=Math.min(a.access/60,1);a.vx+=(cx-a.x)*CENTER_PULL*(0.3+nA*0.7);a.vy+=(cy-a.y)*CENTER_PULL*(0.3+nA*0.7);
      a.vx*=DAMPING;a.vy*=DAMPING;const sp=Math.sqrt(a.vx*a.vx+a.vy*a.vy);if(sp>MAX_VEL){a.vx=a.vx/sp*MAX_VEL;a.vy=a.vy/sp*MAX_VEL;}
      a.x+=a.vx;a.y+=a.vy;const m=80;if(a.x<m)a.vx+=1;if(a.x>W-m)a.vx-=1;if(a.y<m)a.vy+=1;if(a.y>H-m)a.vy-=1;
    }
  }

  function draw(){
    time+=0.008;physics();ctx.save();ctx.fillStyle='#121214';ctx.fillRect(0,0,W,H);
    ctx.translate(transform.x,transform.y);ctx.scale(transform.scale,transform.scale);
    const cx=W/2,cy=H/2,isA=activatedNodes.size>0;

    // Lines
    particles.forEach(a=>a.links.forEach(lid=>{const b=linkMap[lid];if(!b)return;const hot=(activatedNodes.has(a.id)&&activatedNodes.has(b.id))||(searchHits.has(a.id)&&searchHits.has(b.id)),dim=isA&&!hot;const mx=(a.x+b.x)/2+Math.sin(time*0.5+a.id)*5,my=(a.y+b.y)/2+Math.cos(time*0.4+b.id)*5;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.quadraticCurveTo(mx,my,b.x,b.y);ctx.strokeStyle=hot?cc(a.cat,0.55):dim?'rgba(212,182,138,0.02)':'rgba(212,182,138,0.12)';ctx.lineWidth=hot?2.5:1.2;ctx.stroke();if(hot)for(let k=0;k<2;k++){const pt=((time*0.5+a.id*0.1+k*0.5)%1),t2=pt,t1=1-t2;ctx.beginPath();ctx.arc(t1*t1*a.x+2*t1*t2*mx+t2*t2*b.x,t1*t1*a.y+2*t1*t2*my+t2*t2*b.y,2.5,0,Math.PI*2);ctx.fillStyle=cc(a.cat,0.8-pt*0.5);ctx.fill();}}));

    // Center lines
    particles.forEach(a=>{const hit=searchHits.has(a.id)||activatedNodes.has(a.id),act=activeNode&&activeNode.id===a.id,dim=isA&&!hit&&!act;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(a.x,a.y);ctx.strokeStyle=`rgba(212,182,138,${hit?0.2:act?0.25:dim?0.008:0.03})`;ctx.lineWidth=hit||act?1.2:0.4;ctx.stroke();});

    // Center beacon (bigger, brighter)
    const br=Math.sin(time*1.1),pr=30+br*4;ctx.shadowBlur=30;ctx.shadowColor='rgba(212,182,138,0.4)';ctx.beginPath();ctx.arc(cx,cy,pr,0,Math.PI*2);ctx.fillStyle='#18181c';ctx.fill();ctx.strokeStyle=`rgba(212,182,138,${0.5+br*0.2})`;ctx.lineWidth=2;ctx.stroke();ctx.shadowBlur=0;ctx.fillStyle=`rgba(212,182,138,${0.7+br*0.1})`;ctx.font='600 14px JetBrains Mono';ctx.textAlign='center';ctx.fillText('NEXUS',cx,cy+5);

    // Nodes (brighter)
    particles.forEach(a=>{const hit=searchHits.has(a.id)||activatedNodes.has(a.id),act=activeNode&&activeNode.id===a.id,dim=isA&&!hit&&!act,p=Math.sin(time*1.5+a.id*0.6);const sx=a.x*transform.scale+transform.x,sy=a.y*transform.scale+transform.y;if(sx<-80||sx>W+80||sy<-80||sy>H+80)return;const nr=act?ACTIVE_RADIUS+p*2:hit?SYNAPSE_RADIUS+p*1.5:dim?5:BASE_RADIUS+p*0.5;ctx.shadowBlur=hit||act?18:6;ctx.shadowColor=hit||act?cc(a.cat,0.8):cc(a.cat,0.15);ctx.beginPath();ctx.arc(a.x,a.y,nr,0,Math.PI*2);ctx.fillStyle=cc(a.cat,(act?0.9:hit?0.7:dim?0.06:0.35)+p*0.02);ctx.fill();ctx.strokeStyle=cc(a.cat,act?0.6:hit?0.45:dim?0.03:0.12);ctx.lineWidth=act?1.5:0.8;ctx.stroke();ctx.shadowBlur=0;
      const sr=nr*transform.scale;if(sr<5&&!hit&&!act)return;const label=a.node.name.length>22?a.node.name.slice(0,20)+'…':a.node.name,la=act?0.95:hit?0.85:dim?0.05:0.45;ctx.font=`${act?'500 ':'300 '}11px "Libre Franklin"`;ctx.textAlign='center';const tw=ctx.measureText(label).width,tx=a.x,ty=a.y-nr-7;if(la>0.08){ctx.fillStyle=`rgba(0,0,0,${la*0.55})`;ctx.beginPath();ctx.roundRect(tx-tw/2-6,ty-8,tw+12,16,4);ctx.fill();}ctx.fillStyle=`rgba(236,233,225,${la})`;ctx.fillText(label,tx,ty+3,220);});

    ctx.restore();animId=requestAnimationFrame(draw);
  }

  // ═══ CANVAS INTERACTION ═══
  function setupCanvas(){
    canvas.addEventListener('click',e=>{if(dragging)return;const p=stw(e.clientX,e.clientY);let cl=null,cd=35/transform.scale;particles.forEach(a=>{const d=Math.hypot(p.x-a.x,p.y-a.y);if(d<cd){cl=a;cd=d;}});if(cl)openPanel(cl.node);else closePanel();});
    canvas.addEventListener('mousemove',e=>{if(dragging)return;const p=stw(e.clientX,e.clientY);hoverNode=null;particles.forEach(a=>{if(Math.hypot(p.x-a.x,p.y-a.y)<25/transform.scale)hoverNode=a;});canvas.style.cursor=hoverNode?'pointer':'crosshair';});
    canvas.addEventListener('mousedown',e=>{if(e.button!==0)return;dragging=false;dragStart={x:e.clientX,y:e.clientY};dragTransStart={x:transform.x,y:transform.y};const onM=ev=>{const dx=ev.clientX-dragStart.x,dy=ev.clientY-dragStart.y;if(Math.abs(dx)+Math.abs(dy)>5)dragging=true;transform.x=dragTransStart.x+dx*2;transform.y=dragTransStart.y+dy*2;};const onU=()=>{document.removeEventListener('mousemove',onM);document.removeEventListener('mouseup',onU);setTimeout(()=>dragging=false,50);};document.addEventListener('mousemove',onM);document.addEventListener('mouseup',onU);});
    canvas.addEventListener('wheel',e=>{e.preventDefault();const f=e.deltaY>0?0.9:1.1,ns=Math.max(0.3,Math.min(3,transform.scale*f));const r=canvas.getBoundingClientRect(),mx=(e.clientX-r.left)*2,my=(e.clientY-r.top)*2;transform.x=mx-(mx-transform.x)*(ns/transform.scale);transform.y=my-(my-transform.y)*(ns/transform.scale);transform.scale=ns;},{passive:false});
    let ltd=0;canvas.addEventListener('touchstart',e=>{if(e.touches.length===1){dragStart={x:e.touches[0].clientX,y:e.touches[0].clientY};dragTransStart={x:transform.x,y:transform.y};}if(e.touches.length===2)ltd=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);},{passive:true});
    canvas.addEventListener('touchmove',e=>{if(e.touches.length===1){transform.x=dragTransStart.x+(e.touches[0].clientX-dragStart.x)*2;transform.y=dragTransStart.y+(e.touches[0].clientY-dragStart.y)*2;}if(e.touches.length===2){const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);transform.scale=Math.max(0.3,Math.min(3,transform.scale*d/ltd));ltd=d;}},{passive:true});
  }
  function stw(sx,sy){const r=canvas.getBoundingClientRect();return{x:((sx-r.left)*2-transform.x)/transform.scale,y:((sy-r.top)*2-transform.y)/transform.scale};}

  // ═══ NODE PANEL (with SOURCE CITATIONS) ═══
  function openPanel(n){
    activeNode=n;
    document.getElementById('npCat').textContent=n.category.toUpperCase();
    document.getElementById('npName').textContent=n.name;
    document.getElementById('npTags').textContent=(n.tags||[]).map(t=>'#'+t).join('  ');
    document.getElementById('npNotes').textContent=n.notes||'';

    // Source citations
    const srcEl=document.getElementById('npSources');srcEl.innerHTML='';
    const sources=n.sources||n.source_emails;
    if(sources&&Array.isArray(sources)&&sources.length){
      srcEl.innerHTML='<div class="np-sources-title">📧 SOURCES</div>';
      sources.forEach(s=>{
        const d=document.createElement('div');d.className='np-source';
        d.innerHTML=`<div class="np-source-from">${s.from||''}</div><div class="np-source-subject">${s.subject||''}</div><div class="np-source-date">${s.date||''}</div>`;
        srcEl.appendChild(d);
      });
    }

    const le=document.getElementById('npLinks');le.innerHTML='';
    if(n.links&&n.links.length){le.innerHTML='<div style="font-size:8px;letter-spacing:1px;color:var(--faint);margin-bottom:4px">CONNECTED TO</div>';n.links.forEach(lid=>{const ln=NX.nodes.find(x=>x.id===lid);if(ln){const d=document.createElement('div');d.textContent='→ '+ln.name;d.style.cssText='padding:5px 0;cursor:pointer;color:var(--accent);font-size:12px';d.onclick=()=>openPanel(ln);le.appendChild(d);}});}
    document.getElementById('nodePanel').classList.add('open');
  }
  function closePanel(){activeNode=null;document.getElementById('nodePanel').classList.remove('open');}

  // ═══ SEARCH ═══
  function setupSearch(){const inp=document.getElementById('brainSearch'),res=document.getElementById('searchResults');inp.addEventListener('input',()=>{const q=inp.value.toLowerCase().trim();searchHits=new Set();res.innerHTML='';if(!q){res.classList.remove('open');return;}const m=NX.nodes.filter(n=>!n.is_private&&(n.name.toLowerCase().includes(q)||(n.tags||[]).some(t=>t.includes(q))||(n.notes||'').toLowerCase().includes(q)));m.forEach(n=>searchHits.add(n.id));if(m.length){res.classList.add('open');m.forEach(n=>{const d=document.createElement('div');d.className='sr-item';d.innerHTML=`${n.name}<span>${n.category}</span>`;d.onclick=()=>{openPanel(n);res.classList.remove('open');};res.appendChild(d);});}else res.classList.remove('open');});}

  // ═══ LIST VIEW (filter chips + sort) ═══
  function setupListView(){
    document.getElementById('listToggle').addEventListener('click',()=>{listViewOpen=!listViewOpen;const lv=document.getElementById('listView'),btn=document.getElementById('listToggle');if(listViewOpen){btn.classList.add('on');lv.classList.add('open');buildListFilters();renderList();}else{btn.classList.remove('on');lv.classList.remove('open');}});
    document.querySelectorAll('.sort-btn').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.sort-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');listSortMode=b.dataset.sort;renderList();}));
  }
  function buildListFilters(){const fc=document.getElementById('listFilters');fc.innerHTML='';const cats=['all',...new Set(NX.nodes.filter(n=>!n.is_private).map(n=>n.category))];cats.forEach(cat=>{const ch=document.createElement('button');ch.className='filter-chip'+(listFilter===cat?' active':'');ch.textContent=cat==='all'?'All':cat;ch.onclick=()=>{listFilter=cat;buildListFilters();renderList();};fc.appendChild(ch);});}
  function renderList(){const items=document.getElementById('listItems');items.innerHTML='';const q=document.getElementById('brainSearch').value.toLowerCase().trim();let f=NX.nodes.filter(n=>!n.is_private&&(listFilter==='all'||n.category===listFilter)&&(!q||n.name.toLowerCase().includes(q)||(n.tags||[]).some(t=>t.includes(q))||(n.notes||'').toLowerCase().includes(q)));if(listSortMode==='az')f.sort((a,b)=>a.name.localeCompare(b.name));else if(listSortMode==='access')f.sort((a,b)=>(b.access_count||0)-(a.access_count||0));else if(listSortMode==='recent')f.sort((a,b)=>(b.id||0)-(a.id||0));f.forEach(n=>{const el=document.createElement('div');el.className='list-node';el.innerHTML=`<div class="list-node-cat">${n.category}</div><div class="list-node-title">${n.name}</div><div class="list-node-notes">${(n.notes||'').slice(0,120)}</div>`;el.onclick=()=>openPanel(n);items.appendChild(el);});}

  // ═══ CONTRACTOR EVENTS ═══
  function setupContractorEvents(){document.getElementById('eventsToggle').addEventListener('click',()=>{const p=document.getElementById('eventsPanel');p.classList.toggle('open');if(p.classList.contains('open'))loadEvents();});document.getElementById('eventsClose').addEventListener('click',()=>document.getElementById('eventsPanel').classList.remove('open'));document.getElementById('eventAddBtn').addEventListener('click',addEvent);document.getElementById('eventDate').value=NX.today;const dl=document.getElementById('contractorSuggest');dl.innerHTML='';NX.nodes.filter(n=>n.category==='contractors').forEach(n=>{const o=document.createElement('option');o.value=n.name;dl.appendChild(o);});}
  async function loadEvents(){const l=document.getElementById('eventsList');l.innerHTML='<div style="text-align:center;padding:16px;color:var(--faint);font-size:11px">Loading...</div>';try{const{data}=await NX.sb.from('contractor_events').select('*').gte('event_date',NX.today).order('event_date').order('event_time').limit(30);contractorEvents=data||[];}catch(e){contractorEvents=[];}renderEvents();}
  function renderEvents(){const l=document.getElementById('eventsList');l.innerHTML='';if(!contractorEvents.length){l.innerHTML='<div style="text-align:center;padding:24px;color:var(--muted);font-size:12px;line-height:2">No upcoming visits.<br>Schedule one above.</div>';return;}let ld='';contractorEvents.forEach(ev=>{if(ev.event_date!==ld){ld=ev.event_date;const s=document.createElement('div');s.className='event-date-sep'+(ev.event_date===NX.today?' today':'');s.textContent=ev.event_date===NX.today?'TODAY':new Date(ev.event_date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});l.appendChild(s);}const el=document.createElement('div');el.className='event-card';el.innerHTML=`<div class="event-top"><span class="event-contractor">${ev.contractor_name||''}</span><span class="event-time">${ev.event_time?fmtTime(ev.event_time):''}</span></div><div class="event-desc">${ev.description||''}</div><div class="event-bottom"><span class="event-loc">${ev.location?ev.location[0].toUpperCase()+ev.location.slice(1):''}</span><button class="event-done-btn" data-id="${ev.id}">✓</button><button class="event-del-btn" data-id="${ev.id}">✕</button></div>`;el.querySelector('.event-done-btn').addEventListener('click',async e=>{e.stopPropagation();try{await NX.sb.from('contractor_events').update({status:'done'}).eq('id',e.target.dataset.id);}catch(err){}fs(ev.contractor_name);loadEvents();});el.querySelector('.event-del-btn').addEventListener('click',async e=>{e.stopPropagation();try{await NX.sb.from('contractor_events').delete().eq('id',e.target.dataset.id);}catch(err){}loadEvents();});el.addEventListener('click',()=>fs(ev.contractor_name));l.appendChild(el);});}
  function fmtTime(t){if(!t)return'';const[h,m]=t.split(':'),hr=+h;return((hr%12)||12)+':'+m+(hr>=12?' PM':' AM');}
  function fs(name){if(!name)return;const cn=NX.nodes.find(n=>n.category==='contractors'&&name.toLowerCase().includes(n.name.toLowerCase().split(' ')[0]));if(cn){activatedNodes=new Set([cn.id,...(cn.links||[])]);setTimeout(()=>{activatedNodes=new Set();},8000);}}
  async function addEvent(){const c=document.getElementById('eventContractor').value.trim(),d=document.getElementById('eventDesc').value.trim(),dt=document.getElementById('eventDate').value,tm=document.getElementById('eventTime').value,loc=document.getElementById('eventLocation').value;if(!c||!dt)return;const b=document.getElementById('eventAddBtn');b.disabled=true;b.textContent='...';try{await NX.sb.from('contractor_events').insert({contractor_name:c,description:d,event_date:dt,event_time:tm||null,location:loc,status:'scheduled'});document.getElementById('eventContractor').value='';document.getElementById('eventDesc').value='';document.getElementById('eventTime').value='';loadEvents();fs(c);}catch(e){}b.disabled=false;b.textContent='+ Schedule';}

  // ═══ AI CHAT ═══
  function setupChat(){const i=document.getElementById('chatInput'),s=document.getElementById('chatSend'),dim=document.getElementById('brainDim'),r=document.getElementById('resetBtn');i.addEventListener('input',()=>{s.disabled=!i.value.trim();});i.addEventListener('focus',()=>dim.classList.add('active'));i.addEventListener('blur',()=>{if(!i.value.trim()&&!chatActive)dim.classList.remove('active');});i.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();askAI();}});s.addEventListener('click',askAI);r.addEventListener('click',resetChat);document.querySelectorAll('.brain-ex').forEach(b=>b.addEventListener('click',()=>{i.value=b.textContent;s.disabled=false;askAI();}));}
  function resetChat(){chatHistory=[];chatActive=false;document.getElementById('chatMessages').innerHTML='';document.getElementById('brainWelcome').style.display='';document.getElementById('brainExamples').style.display='';document.getElementById('brainDim').classList.remove('active');document.getElementById('resetBtn').style.display='none';activatedNodes=new Set();}
  function getSmartContext(q){const w=q.toLowerCase().split(/\s+/).filter(x=>x.length>2);const sc=NX.nodes.map(n=>{let s=0;const t=(n.name+' '+n.category+' '+(n.tags||[]).join(' ')+' '+(n.notes||'')+' '+JSON.stringify(n.sources||n.source_emails||[])).toLowerCase();w.forEach(x=>{if(t.includes(x))s+=t.split(x).length-1;});if(n.name.toLowerCase().includes(q.toLowerCase()))s+=10;return{node:n,score:s};}).filter(s=>s.score>0).sort((a,b)=>b.score-a.score);const rel=sc.slice(0,10).map(s=>s.node);const idx=NX.nodes.filter(n=>!n.is_private).map(n=>`${n.name} (${n.category})`).join(', ');
    // Include source emails in context for relevant nodes
    const det=rel.map(n=>{let src='';const sources=n.sources||n.source_emails;if(sources&&sources.length)src=' [Sources: '+sources.map(s=>`${s.from} "${s.subject}" ${s.date}`).join('; ')+']';return`[${n.category}] ${n.name}: ${n.notes}${src}`;}).join('\n');
    activatedNodes=new Set(rel.map(n=>n.id));setTimeout(()=>{activatedNodes=new Set();},12000);let ev='';if(contractorEvents.length)ev='\n\nUPCOMING CONTRACTOR VISITS:\n'+contractorEvents.slice(0,8).map(e=>`${e.contractor_name} — ${e.description||'visit'} @ ${e.location||'?'} on ${e.event_date}`).join('\n');return`RELEVANT NODES:\n${det}\n\nFULL INDEX (${NX.nodes.length} nodes):\n${idx}${ev}`;}
  async function askAI(){const i=document.getElementById('chatInput'),q=i.value.trim();if(!q)return;i.value='';document.getElementById('chatSend').disabled=true;document.getElementById('brainWelcome').style.display='none';document.getElementById('brainExamples').style.display='none';document.getElementById('brainDim').classList.add('active');document.getElementById('resetBtn').style.display='';chatActive=true;addBubble(q,'user');chatHistory.push({role:'user',content:q});const th=addBubble(`Cross-referencing ${NX.nodes.length} nodes...`,'ai thinking');const ctx=getSmartContext(q);const msgs=chatHistory.slice(-6).map(m=>({role:m.role==='user'?'user':'assistant',content:m.content}));try{const ans=await NX.askClaude(PERSONA+'\n\n'+ctx,msgs,600);th.textContent=ans||'Something went sideways.';th.classList.remove('chat-thinking');chatHistory.push({role:'assistant',content:ans});if(voiceOn)speak(ans);try{NX.sb.from('chat_history').insert({question:q,answer:ans});}catch(e){}}catch(e){th.textContent=e.message||'Connection hiccup.';th.classList.remove('chat-thinking');}}
  function addBubble(t,type){const el=document.createElement('div');el.className='chat-bubble chat-'+(type.includes('user')?'user':'ai');if(type.includes('thinking'))el.classList.add('chat-thinking');el.textContent=t;el.style[type.includes('user')?'marginLeft':'marginRight']='auto';const c=document.getElementById('chatMessages');c.appendChild(el);c.scrollTop=c.scrollHeight;return el;}

  // ═══ VOICE (5 ElevenLabs voices) ═══
  let pv=null;const VOICES=[{id:'pNInz6obpgDQGcFmaJgB',name:'Adam',desc:'Sharp & confident'},{id:'EXAVITQu4vr4xnSDxMaL',name:'Bella',desc:'Warm & witty'},{id:'onwK4e9ZLuTAKqWW03F9',name:'Daniel',desc:'British dry wit'},{id:'XB0fDUnXU5powFXDhCwa',name:'Charlotte',desc:'Smart & smooth'},{id:'TX3LPaxmHKxFdv7VOQHJ',name:'Liam',desc:'Casual & quick'}];let cvi=parseInt(localStorage.getItem('nexus_voice_idx')||'0')%VOICES.length;
  function setupVoice(){document.getElementById('micBtn').addEventListener('click',toggleMic);const vb=document.getElementById('voiceBtn');let pt=null;vb.addEventListener('click',()=>{voiceOn=!voiceOn;vb.classList.toggle('on',voiceOn);if(voiceOn)vb.title=`Voice: ${VOICES[cvi].name} (hold to switch)`;});vb.addEventListener('pointerdown',()=>{pt=setTimeout(()=>{cvi=(cvi+1)%VOICES.length;localStorage.setItem('nexus_voice_idx',cvi);voiceOn=true;vb.classList.add('on');vb.title=`Voice: ${VOICES[cvi].name}`;speak(`Hey, I'm ${VOICES[cvi].name}. ${VOICES[cvi].desc}.`);pt=null;},600);});vb.addEventListener('pointerup',()=>{if(pt)clearTimeout(pt);});vb.addEventListener('pointerleave',()=>{if(pt)clearTimeout(pt);});if('speechSynthesis'in window){const pk=()=>{const v=speechSynthesis.getVoices();for(const n of['Samantha','Karen','Daniel','Microsoft Aria']){const f=v.find(x=>x.name.includes(n));if(f){pv=f;break;}}if(!pv&&v.length)pv=v.find(x=>x.lang.startsWith('en'))||v[0];};pk();speechSynthesis.onvoiceschanged=pk;}}
  function toggleMic(){const b=document.getElementById('micBtn');if(recognition){recognition.stop();recognition=null;b.classList.remove('recording');return;}if(!('webkitSpeechRecognition'in window||'SpeechRecognition'in window))return;const SR=window.SpeechRecognition||window.webkitSpeechRecognition;recognition=new SR();recognition.continuous=false;recognition.interimResults=false;recognition.onresult=e=>{document.getElementById('chatInput').value=e.results[0][0].transcript;document.getElementById('chatSend').disabled=false;b.classList.remove('recording');recognition=null;askAI();};recognition.onerror=()=>{b.classList.remove('recording');recognition=null;};recognition.onend=()=>{b.classList.remove('recording');recognition=null;};b.classList.add('recording');recognition.start();}
  async function speak(text){const ek=NX.getElevenLabsKey();if(ek){try{const r=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICES[cvi].id}`,{method:'POST',headers:{'Content-Type':'application/json','xi-api-key':ek},body:JSON.stringify({text:text.slice(0,800),model_id:'eleven_turbo_v2',voice_settings:{stability:0.45,similarity_boost:0.78,style:0.35,use_speaker_boost:true}})});if(r.ok){const bl=await r.blob(),u=URL.createObjectURL(bl),a=new Audio(u);a.play();a.onended=()=>URL.revokeObjectURL(u);return;}}catch(e){}}if(!('speechSynthesis'in window))return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text.slice(0,600));if(pv)u.voice=pv;u.rate=0.95;speechSynthesis.speak(u);}

  NX.brain={init,closePanel,show:()=>{resize();}};NX.modules.brain=NX.brain;NX.loaded.brain=true;
})();
