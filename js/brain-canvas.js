/* NEXUS Brain Canvas v8 — Physics, rendering, interaction */
(function(){
  const canvas=document.getElementById('brainCanvas'),ctx=canvas.getContext('2d');
  let W,H,time=0,physicsFrame=0,physicsSleeping=false,lastInteraction=Date.now();

  // Shared state — exposed on NX.brain for other modules
  const state={
    particles:[],transform:{x:0,y:0,scale:1},
    dragging:false,dragStart:{x:0,y:0},dragTransStart:{x:0,y:0},
    hoverNode:null,activeNode:null,
    activatedNodes:new Set(),searchHits:new Set(),
    linkMap:{},catMap:{},tagSets:{},
    contractorEvents:[],
    W:0,H:0,canvas,ctx
  };

  const REP=1200,ATT=0.001,LINK=0.003,CPULL=0.0001,DAMP=0.84,MAXV=4;
  const IDC=250,IDT=140,IDL=120,BR=9,AR=18,SR2=14;
  const CC={location:{r:220,g:186,b:140},equipment:{r:120,g:160,b:210},procedure:{r:140,g:175,b:120},contractors:{r:210,g:148,b:120},vendors:{r:170,g:140,b:210},projects:{r:210,g:190,b:120},systems:{r:120,g:210,b:190},parts:{r:180,g:158,b:158},people:{r:180,g:160,b:210}};
  function cc(cat,a){const c=CC[cat]||CC.equipment;return`rgba(${c.r},${c.g},${c.b},${a})`;}

  function resize(){
    const r=canvas.getBoundingClientRect();
    const dpr=Math.min(window.devicePixelRatio||1,1.5);
    W=r.width*dpr;H=r.height*dpr;
    canvas.width=W;canvas.height=H;
    canvas.style.width=r.width+'px';canvas.style.height=r.height+'px';
    state.W=W;state.H=H;wakePhysics();
  }
  window.addEventListener('resize',()=>{if(document.getElementById('brainView').classList.contains('active'))resize();});

  function wakePhysics(){physicsSleeping=false;lastInteraction=Date.now();}

  function buildParticles(){
    const nodes=NX.nodes.filter(n=>!n.is_private),cx=W/2,cy=H/2;
    const cats=[...new Set(nodes.map(n=>n.category))],ca={};cats.forEach((c,i)=>{ca[c]=(i/cats.length)*Math.PI*2;});
    state.particles=nodes.map(n=>{const b=ca[n.category]||0,j=(Math.random()-0.5)*1.2,d=300+Math.random()*900;return{id:n.id,x:cx+Math.cos(b+j)*d,y:cy+Math.sin(b+j)*d,vx:0,vy:0,node:n,cat:n.category,tags:n.tags||[],links:n.links||[],access:n.access_count||1};});
    state.linkMap={};state.catMap={};state.tagSets={};
    state.particles.forEach((p,i)=>{state.linkMap[p.id]=p;if(!state.catMap[p.cat])state.catMap[p.cat]=[];state.catMap[p.cat].push(i);state.tagSets[i]=new Set(p.tags);});
  }

  function physics(){
    if(physicsSleeping)return;
    const particles=state.particles,len=particles.length,cx=W/2,cy=H/2;
    const ih=state.hoverNode!==null,CELL=200,grid=new Map();
    let totalEnergy=0;
    for(let i=0;i<len;i++){const a=particles[i];const key=((Math.floor(a.x/CELL)+500)<<16)|(Math.floor(a.y/CELL)+500);let cell=grid.get(key);if(!cell){cell=[];grid.set(key,cell);}cell.push(i);}
    for(let i=0;i<len;i++){const a=particles[i];
      if(ih&&Math.hypot(a.x-state.hoverNode.x,a.y-state.hoverNode.y)<100){a.vx*=0.05;a.vy*=0.05;continue;}
      const gx=Math.floor(a.x/CELL)+500,gy=Math.floor(a.y/CELL)+500;
      for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++){const nb=grid.get(((gx+ox)<<16)|(gy+oy));if(!nb)continue;for(let ni=0;ni<nb.length;ni++){const j=nb[ni];if(j<=i)continue;const b=particles[j];let dx=a.x-b.x,dy=a.y-b.y,dS=dx*dx+dy*dy;if(dS>160000)continue;let d=Math.sqrt(dS)||1,f=REP/dS;a.vx+=dx/d*f;a.vy+=dy/d*f;b.vx-=dx/d*f;b.vy-=dy/d*f;}}
      const sc=state.catMap[a.cat];if(sc){const step=sc.length>30?Math.ceil(sc.length/30):1;for(let ci=0;ci<sc.length;ci+=step){const j=sc[ci];if(j===i)continue;const b=particles[j];let dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1;a.vx+=dx/d*(d-IDC)*ATT;a.vy+=dy/d*(d-IDC)*ATT;}}
      const aT=state.tagSets[i];if(aT&&aT.size>0){for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++){const nb=grid.get(((gx+ox)<<16)|(gy+oy));if(!nb)continue;for(let ni=0;ni<nb.length;ni++){const j=nb[ni];if(j===i)continue;const bT=state.tagSets[j];if(!bT)continue;let sh=0;for(const t of aT)if(bT.has(t))sh++;if(!sh)continue;const b=particles[j];let dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1;a.vx+=dx/d*(d-IDT)*ATT*sh*1.2;a.vy+=dy/d*(d-IDT)*ATT*sh*1.2;}}}
      for(let li=0;li<a.links.length;li++){const b=state.linkMap[a.links[li]];if(!b)continue;let dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1;a.vx+=dx/d*(d-IDL)*LINK;a.vy+=dy/d*(d-IDL)*LINK;}
      const nA=Math.min(a.access/60,1);a.vx+=(cx-a.x)*CPULL*(0.3+nA*0.7);a.vy+=(cy-a.y)*CPULL*(0.3+nA*0.7);
      const cdist=Math.sqrt((a.x-cx)*(a.x-cx)+(a.y-cy)*(a.y-cy))||1;
      if(cdist<160){const cf=(160-cdist)*0.1;a.vx+=(a.x-cx)/cdist*cf;a.vy+=(a.y-cy)/cdist*cf;}
      const orbitSpeed=0.2/(1+cdist*0.002);a.vx+=-(a.y-cy)/cdist*orbitSpeed;a.vy+=(a.x-cx)/cdist*orbitSpeed;
      a.vx*=DAMP;a.vy*=DAMP;const sp=a.vx*a.vx+a.vy*a.vy;if(sp>MAXV*MAXV){const s=Math.sqrt(sp);a.vx=a.vx/s*MAXV;a.vy=a.vy/s*MAXV;}totalEnergy+=sp;a.x+=a.vx;a.y+=a.vy;
      if(a.x<80)a.vx+=1;if(a.x>W-80)a.vx-=1;if(a.y<80)a.vy+=1;if(a.y>H-80)a.vy-=1;
    }
    if(totalEnergy<len*0.01&&Date.now()-lastInteraction>5000)physicsSleeping=true;
  }

  function draw(){
    time+=0.008;physicsFrame++;
    if(state.particles.length<500||physicsFrame%2===0)physics();
    ctx.save();ctx.fillStyle='#121214';ctx.fillRect(0,0,W,H);
    const t=state.transform;ctx.translate(t.x,t.y);ctx.scale(t.scale,t.scale);
    const cx=W/2,cy=H/2,isA=state.activatedNodes.size>0,particles=state.particles;
    const invScale=1/t.scale,vl=-t.x*invScale-100,vr=(-t.x+W)*invScale+100,vt=-t.y*invScale-100,vb=(-t.y+H)*invScale+100;

    // Connection lines (batched)
    ctx.lineWidth=1.2;ctx.strokeStyle='rgba(212,182,138,.25)';ctx.beginPath();
    for(let i=0;i<particles.length;i++){const a=particles[i];if(a.x<vl||a.x>vr||a.y<vt||a.y>vb)continue;
      for(let li=0;li<a.links.length;li++){const b=state.linkMap[a.links[li]];if(!b)continue;
        if((state.activatedNodes.has(a.id)&&state.activatedNodes.has(b.id))||(state.searchHits.has(a.id)&&state.searchHits.has(b.id)))continue;
        ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);}}
    ctx.stroke();

    // Hot lines
    for(let i=0;i<particles.length;i++){const a=particles[i];for(let li=0;li<a.links.length;li++){const b=state.linkMap[a.links[li]];if(!b)continue;
      if(!((state.activatedNodes.has(a.id)&&state.activatedNodes.has(b.id))||(state.searchHits.has(a.id)&&state.searchHits.has(b.id))))continue;
      const mx=(a.x+b.x)/2+Math.sin(time*.5+a.id)*5,my=(a.y+b.y)/2+Math.cos(time*.4)*5;
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.quadraticCurveTo(mx,my,b.x,b.y);ctx.strokeStyle=cc(a.cat,.7);ctx.lineWidth=3;ctx.stroke();}}

    // Center lines (top accessed only)
    ctx.lineWidth=0.5;ctx.strokeStyle='rgba(212,182,138,.06)';ctx.beginPath();
    for(let i=0;i<particles.length;i++){const a=particles[i];const hit=state.searchHits.has(a.id)||state.activatedNodes.has(a.id);
      if(!hit&&a.access<=10)continue;
      if(hit){ctx.stroke();ctx.beginPath();ctx.strokeStyle='rgba(212,182,138,.3)';ctx.lineWidth=1.2;ctx.moveTo(cx,cy);ctx.lineTo(a.x,a.y);ctx.stroke();ctx.beginPath();ctx.strokeStyle='rgba(212,182,138,.06)';ctx.lineWidth=0.5;}
      else{ctx.moveTo(cx,cy);ctx.lineTo(a.x,a.y);}}
    ctx.stroke();

    // Center beacon
    const br=Math.sin(time*1.1),pr=55+br*5;ctx.shadowBlur=40;ctx.shadowColor='rgba(212,182,138,.6)';
    ctx.beginPath();ctx.arc(cx,cy,pr,0,Math.PI*2);ctx.fillStyle='#18181c';ctx.fill();
    ctx.strokeStyle=`rgba(212,182,138,${.6+br*.2})`;ctx.lineWidth=2.5;ctx.stroke();ctx.shadowBlur=0;
    ctx.fillStyle=`rgba(212,182,138,${.85+br*.1})`;ctx.font='600 18px JetBrains Mono';ctx.textAlign='center';ctx.fillText('NEXUS',cx,cy+6);

    // Nodes
    for(let i=0;i<particles.length;i++){const a=particles[i];
      if(a.x<vl||a.x>vr||a.y<vt||a.y>vb)continue;
      const hit=state.searchHits.has(a.id)||state.activatedNodes.has(a.id),act=state.activeNode&&state.activeNode.id===a.id;
      const dim=isA&&!hit&&!act,p=Math.sin(time*1.5+a.id*.6);
      const nr=act?AR+p*2:hit?SR2+p*1.5:dim?4:BR+p*.4;
      if(hit||act){ctx.shadowBlur=16;ctx.shadowColor=cc(a.cat,.8);}
      ctx.beginPath();ctx.arc(a.x,a.y,nr,0,Math.PI*2);ctx.fillStyle=cc(a.cat,act?.95:hit?.8:dim?.08:.55);ctx.fill();
      ctx.strokeStyle=cc(a.cat,act?.7:hit?.55:dim?.04:.25);ctx.lineWidth=act?2:0.8;ctx.stroke();
      if(hit||act)ctx.shadowBlur=0;
      const sr=nr*t.scale;if(sr<4&&!hit&&!act)continue;if(dim)continue;
      const label=a.node.name.length>20?a.node.name.slice(0,18)+'…':a.node.name;
      ctx.font=`${act?'500 ':'300 '}${sr>8?'11':'9'}px "Libre Franklin"`;ctx.textAlign='center';
      ctx.fillStyle=`rgba(236,233,225,${act?.95:hit?.9:.5})`;ctx.fillText(label,a.x,a.y-nr-6+3,200);
    }
    ctx.restore();requestAnimationFrame(draw);
  }

  function setupCanvas(){
    const dpr=()=>Math.min(window.devicePixelRatio||1,1.5);
    canvas.addEventListener('click',e=>{if(state.dragging)return;wakePhysics();const p=stw(e.clientX,e.clientY);let cl=null,cd=35/state.transform.scale;state.particles.forEach(a=>{const d=Math.hypot(p.x-a.x,p.y-a.y);if(d<cd){cl=a;cd=d;}});if(cl)openPanel(cl.node);else closePanel();});
    canvas.addEventListener('mousemove',e=>{if(state.dragging)return;const p=stw(e.clientX,e.clientY);state.hoverNode=null;state.particles.forEach(a=>{if(Math.hypot(p.x-a.x,p.y-a.y)<25/state.transform.scale)state.hoverNode=a;});canvas.style.cursor=state.hoverNode?'pointer':'crosshair';if(state.hoverNode)wakePhysics();});
    canvas.addEventListener('mousedown',e=>{if(e.button!==0)return;state.dragging=false;state.dragStart={x:e.clientX,y:e.clientY};state.dragTransStart={x:state.transform.x,y:state.transform.y};const onM=ev=>{const dx=ev.clientX-state.dragStart.x,dy=ev.clientY-state.dragStart.y;if(Math.abs(dx)+Math.abs(dy)>5)state.dragging=true;state.transform.x=state.dragTransStart.x+dx*dpr();state.transform.y=state.dragTransStart.y+dy*dpr();};const onU=()=>{document.removeEventListener('mousemove',onM);document.removeEventListener('mouseup',onU);setTimeout(()=>state.dragging=false,50);};document.addEventListener('mousemove',onM);document.addEventListener('mouseup',onU);});
    canvas.addEventListener('wheel',e=>{e.preventDefault();wakePhysics();const f=e.deltaY>0?.9:1.1,ns=Math.max(.2,Math.min(4,state.transform.scale*f));const r=canvas.getBoundingClientRect(),mx=(e.clientX-r.left)*dpr(),my=(e.clientY-r.top)*dpr();state.transform.x=mx-(mx-state.transform.x)*(ns/state.transform.scale);state.transform.y=my-(my-state.transform.y)*(ns/state.transform.scale);state.transform.scale=ns;},{passive:false});
    let ltd=0;canvas.addEventListener('touchstart',e=>{wakePhysics();if(e.touches.length===1){state.dragStart={x:e.touches[0].clientX,y:e.touches[0].clientY};state.dragTransStart={x:state.transform.x,y:state.transform.y};}if(e.touches.length===2)ltd=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);},{passive:true});
    canvas.addEventListener('touchmove',e=>{const d2=dpr();if(e.touches.length===1){state.transform.x=state.dragTransStart.x+(e.touches[0].clientX-state.dragStart.x)*d2;state.transform.y=state.dragTransStart.y+(e.touches[0].clientY-state.dragStart.y)*d2;}if(e.touches.length===2){const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);state.transform.scale=Math.max(.2,Math.min(4,state.transform.scale*d/ltd));ltd=d;}},{passive:true});
  }
  function stw(sx,sy){const r=canvas.getBoundingClientRect(),d=Math.min(window.devicePixelRatio||1,1.5);return{x:((sx-r.left)*d-state.transform.x)/state.transform.scale,y:((sy-r.top)*d-state.transform.y)/state.transform.scale};}

  function openPanel(n){state.activeNode=n;wakePhysics();document.getElementById('npCat').textContent=n.category.toUpperCase();document.getElementById('npName').textContent=n.name;document.getElementById('npTags').textContent=(n.tags||[]).map(t=>'#'+t).join('  ');document.getElementById('npNotes').textContent=n.notes||'';
    const se=document.getElementById('npSources');se.innerHTML='';const src=n.sources||n.source_emails;if(src&&Array.isArray(src)&&src.length){se.innerHTML='<div class="np-sources-title">SOURCES</div>';src.forEach(s=>{const d=document.createElement('div');d.className='np-source';d.innerHTML=`<div class="np-source-from">${s.from||''}</div><div class="np-source-subject">${s.subject||''}</div><div class="np-source-date">${s.date||''}</div>`;se.appendChild(d);});}
    const le=document.getElementById('npLinks');le.innerHTML='';if(n.links&&n.links.length){le.innerHTML='<div style="font-size:8px;letter-spacing:1px;color:var(--faint);margin-bottom:4px">CONNECTED TO</div>';n.links.forEach(lid=>{const ln=NX.nodes.find(x=>x.id===lid);if(ln){const d=document.createElement('div');d.textContent='→ '+ln.name;d.style.cssText='padding:5px 0;cursor:pointer;color:var(--accent);font-size:12px';d.onclick=()=>openPanel(ln);le.appendChild(d);}});}
    document.getElementById('nodePanel').classList.add('open');}
  function closePanel(){state.activeNode=null;document.getElementById('nodePanel').classList.remove('open');}

  function checkEmpty(){const e=document.getElementById('canvasEmpty');if(e)e.style.display=NX.nodes.length<=1?'flex':'none';}

  function init(){
    resize();buildParticles();for(let i=0;i<300;i++)physics();
    setupCanvas();checkEmpty();
    // Init other modules
    if(NX.brain.initChat)NX.brain.initChat();
    if(NX.brain.initList)NX.brain.initList();
    if(NX.brain.initEvents)NX.brain.initEvents();
    draw();
  }

  // Expose shared state + functions
  NX.brain={init,closePanel,state,wakePhysics,cc,
    show:()=>{resize();},
    openPanel};
  NX.modules.brain=NX.brain;NX.loaded.brain=true;
})();
