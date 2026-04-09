/* NEXUS Brain Canvas v9 — Galaxy Simulation
   Spiral arm placement, Keplerian orbits, beacon-style glow, black hole slingshot
*/
(function(){
  const canvas=document.getElementById('brainCanvas'),ctx=canvas.getContext('2d');
  let W,H,time=0,physicsFrame=0,physicsSleeping=false,lastInteraction=Date.now();

  const state={
    particles:[],transform:{x:0,y:0,scale:1},
    dragging:false,dragStart:{x:0,y:0},dragTransStart:{x:0,y:0},
    hoverNode:null,activeNode:null,
    activatedNodes:new Set(),searchHits:new Set(),
    linkMap:{},catMap:{},tagSets:{},
    contractorEvents:[],W:0,H:0,canvas,ctx
  };

  // Physics — tuned for graceful galaxy
  const DAMP=0.993,MAXV=1.0;
  const BR=8,AR=16,SR2=12;
  const CC={location:{r:220,g:186,b:140},equipment:{r:140,g:170,b:220},procedure:{r:150,g:190,b:140},contractors:{r:220,g:160,b:130},vendors:{r:180,g:150,b:220},projects:{r:220,g:200,b:130},systems:{r:130,g:220,b:200},parts:{r:195,g:170,b:170},people:{r:190,g:170,b:220}};
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

  // ═══ GALAXY PLACEMENT — logarithmic spiral arms ═══
  function buildParticles(){
    const nodes=NX.nodes.filter(n=>!n.is_private),cx=W/2,cy=H/2;
    const ARMS=3;
    const galaxyR=Math.min(W,H)*0.4;

    state.particles=nodes.map((n,idx)=>{
      const arm=idx%ARMS;
      const armBase=(arm/ARMS)*Math.PI*2;
      const t=(idx/nodes.length);
      // Distance: denser near center, sparser at edges
      const r=40+Math.pow(t,0.7)*galaxyR;
      // Spiral winding + randomness
      const wind=armBase+t*4.5+(Math.random()-0.5)*0.8;
      // Perpendicular scatter — more at outer edges
      const scatter=(Math.random()-0.5)*50*(0.5+t);
      const px=cx+Math.cos(wind)*r+Math.cos(wind+1.57)*scatter;
      const py=cy+Math.sin(wind)*r+Math.sin(wind+1.57)*scatter;
      // Initial tangential velocity — Keplerian: faster near center
      const speed=1.8/Math.sqrt(Math.max(r/galaxyR,0.1));
      const vx=-(py-cy)/(r||1)*speed*0.015;
      const vy=(px-cx)/(r||1)*speed*0.015;
      return{id:n.id,x:px,y:py,vx,vy,node:n,cat:n.category,
        tags:n.tags||[],links:n.links||[],access:n.access_count||1};
    });
    state.linkMap={};state.catMap={};state.tagSets={};
    state.particles.forEach((p,i)=>{
      state.linkMap[p.id]=p;
      if(!state.catMap[p.cat])state.catMap[p.cat]=[];
      state.catMap[p.cat].push(i);
      state.tagSets[i]=new Set(p.tags);
    });
  }

  // ═══ PHYSICS — pure orbital mechanics ═══
  function physics(){
    if(physicsSleeping)return;
    const P=state.particles,len=P.length,cx=W/2,cy=H/2;
    const galaxyR=Math.min(W,H)*0.4;
    let totalE=0;

    // Spatial grid for collision only
    const CELL=50,grid=new Map();
    for(let i=0;i<len;i++){
      const a=P[i];
      const key=((Math.floor(a.x/CELL)+500)<<16)|(Math.floor(a.y/CELL)+500);
      let c=grid.get(key);if(!c){c=[];grid.set(key,c);}c.push(i);
    }

    for(let i=0;i<len;i++){
      const a=P[i];
      // Hover pause
      if(state.hoverNode&&Math.hypot(a.x-state.hoverNode.x,a.y-state.hoverNode.y)<60){
        a.vx*=0.1;a.vy*=0.1;continue;
      }

      const dx=a.x-cx,dy=a.y-cy;
      const dist=Math.sqrt(dx*dx+dy*dy)||1;

      // 1. Keplerian orbit — tangential velocity correction
      const targetV=1.8/Math.sqrt(Math.max(dist/galaxyR,0.08));
      const tx=-dy/dist,ty=dx/dist; // tangential direction
      const currentTangentV=a.vx*tx+a.vy*ty;
      const correction=(targetV*0.015-currentTangentV)*0.005;
      a.vx+=tx*correction;
      a.vy+=ty*correction;

      // 2. Black hole slingshot — very close only
      if(dist<20){
        const sling=15*(1-dist/20);
        a.vx+=dx/dist*sling;a.vy+=dy/dist*sling;
      }

      // 3. Gentle inward pull — prevents dispersal
      a.vx-=dx/dist*0.0008;
      a.vy-=dy/dist*0.0008;

      // 4. Soft boundary — pushes back at galaxy edge
      if(dist>galaxyR*1.2){
        const over=(dist-galaxyR*1.2)*0.002;
        a.vx-=dx/dist*over;a.vy-=dy/dist*over;
      }

      // 5. Overlap prevention — only very close neighbors
      const gx=Math.floor(a.x/CELL)+500,gy=Math.floor(a.y/CELL)+500;
      for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++){
        const nb=grid.get(((gx+ox)<<16)|(gy+oy));if(!nb)continue;
        for(let ni=0;ni<nb.length;ni++){
          const j=nb[ni];if(j<=i)continue;
          const b=P[j];
          const ddx=a.x-b.x,ddy=a.y-b.y;
          const dd=Math.sqrt(ddx*ddx+ddy*ddy)||1;
          if(dd<BR*2.5){
            const push=(BR*2.5-dd)*0.08;
            a.vx+=ddx/dd*push;a.vy+=ddy/dd*push;
            b.vx-=ddx/dd*push;b.vy-=ddy/dd*push;
          }
        }
      }

      // Damping
      a.vx*=DAMP;a.vy*=DAMP;
      const sp=a.vx*a.vx+a.vy*a.vy;
      // Only cap if not slung
      if(dist>25&&sp>MAXV*MAXV){const s=Math.sqrt(sp);a.vx=a.vx/s*MAXV;a.vy=a.vy/s*MAXV;}
      totalE+=sp;
      a.x+=a.vx;a.y+=a.vy;
    }
    if(totalE<len*0.0001&&Date.now()-lastInteraction>8000)physicsSleeping=true;
  }

  // ═══ RENDER — beacon-style glow + galaxy aesthetic ═══
  function draw(){
    time+=0.006;physicsFrame++;
    const P=state.particles,t=state.transform;
    if(P.length<500||physicsFrame%2===0)physics();

    ctx.save();
    ctx.fillStyle='#0a0a0e';ctx.fillRect(0,0,W,H);
    ctx.translate(t.x,t.y);ctx.scale(t.scale,t.scale);

    const cx=W/2,cy=H/2;
    const isA=state.activatedNodes.size>0;
    const invS=1/t.scale;
    const vl=-t.x*invS-200,vr=(-t.x+W)*invS+200;
    const vt=-t.y*invS-200,vb=(-t.y+H)*invS+200;

    // Gold connection lines — max 10
    let lc=0;
    ctx.lineWidth=0.6;ctx.strokeStyle='rgba(212,182,138,.18)';ctx.beginPath();
    for(let i=0;i<P.length&&lc<10;i++){
      const a=P[i];if(a.x<vl||a.x>vr||a.y<vt||a.y>vb)continue;
      for(let li=0;li<a.links.length&&lc<10;li++){
        const b=state.linkMap[a.links[li]];if(!b)continue;
        ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);lc++;
      }
    }
    ctx.stroke();

    // Activated connection lines — gold glow
    for(let i=0;i<P.length;i++){
      const a=P[i];
      for(let li=0;li<a.links.length;li++){
        const b=state.linkMap[a.links[li]];if(!b)continue;
        const hot=(state.activatedNodes.has(a.id)&&state.activatedNodes.has(b.id));
        if(!hot)continue;
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
        ctx.strokeStyle='rgba(212,182,138,.5)';ctx.lineWidth=2;ctx.stroke();
      }
    }

    // NEXUS center beacon — triple glow
    const br=Math.sin(time*1.1);
    const beaconR=45+br*4;
    // Outer bloom
    ctx.beginPath();ctx.arc(cx,cy,beaconR*2.5,0,Math.PI*2);
    ctx.fillStyle=`rgba(212,182,138,.025)`;ctx.fill();
    // Mid
    ctx.beginPath();ctx.arc(cx,cy,beaconR*1.6,0,Math.PI*2);
    ctx.fillStyle=`rgba(212,182,138,.05)`;ctx.fill();
    // Core
    ctx.shadowBlur=30;ctx.shadowColor='rgba(212,182,138,.5)';
    ctx.beginPath();ctx.arc(cx,cy,beaconR,0,Math.PI*2);
    ctx.fillStyle='#0e0e12';ctx.fill();
    ctx.strokeStyle=`rgba(212,182,138,${.55+br*.15})`;ctx.lineWidth=2;ctx.stroke();
    ctx.shadowBlur=0;
    ctx.fillStyle=`rgba(212,182,138,${.8+br*.1})`;
    ctx.font='600 15px "JetBrains Mono"';ctx.textAlign='center';
    ctx.fillText('NEXUS',cx,cy+5);

    // ═══ NODES — two-pass: glow then core ═══
    // Pass 1: Subtle gold glow (skip dimmed)
    for(let i=0;i<P.length;i++){
      const a=P[i];
      if(a.x<vl||a.x>vr||a.y<vt||a.y>vb)continue;
      const hit=state.searchHits.has(a.id)||state.activatedNodes.has(a.id);
      const act=state.activeNode&&state.activeNode.id===a.id;
      const dim=isA&&!hit&&!act;
      if(dim)continue;
      const pulse=0.8+0.2*Math.sin(time*1.1+a.id*0.7);
      const nr=(act?AR:hit?SR2:BR)*pulse;
      const ga=act?0.08:hit?0.05:0.025;
      ctx.beginPath();ctx.arc(a.x,a.y,nr*2.2,0,Math.PI*2);
      ctx.fillStyle=`rgba(212,182,138,${ga*pulse})`;ctx.fill();
    }

    // Pass 2: Core + label
    for(let i=0;i<P.length;i++){
      const a=P[i];
      if(a.x<vl||a.x>vr||a.y<vt||a.y>vb)continue;
      const hit=state.searchHits.has(a.id)||state.activatedNodes.has(a.id);
      const act=state.activeNode&&state.activeNode.id===a.id;
      const dim=isA&&!hit&&!act;
      const pulse=0.8+0.2*Math.sin(time*1.1+a.id*0.7);
      const nr=(act?AR:hit?SR2:dim?2.5:BR)*pulse;
      // Wobble
      const wb=Math.sin(time*0.7+a.id*1.1)*1;
      const wx=a.x+wb*Math.cos(a.id*2.3);
      const wy=a.y+wb*Math.sin(a.id*2.3);
      // Core
      const alpha=act?0.92:hit?0.82:dim?0.04:0.5;
      ctx.beginPath();ctx.arc(wx,wy,nr,0,Math.PI*2);
      ctx.fillStyle=`rgba(245,242,235,${alpha*pulse})`;ctx.fill();
      // Gold ring
      ctx.strokeStyle=`rgba(212,182,138,${(act?0.55:hit?0.4:dim?0.02:0.18)*pulse})`;
      ctx.lineWidth=act?1.5:0.5;ctx.stroke();
      // Dark label inside
      const sr=nr*t.scale;
      if(sr<5.5&&!hit&&!act)continue;if(dim)continue;
      const maxC=Math.max(2,Math.floor(nr/3.2));
      const label=a.node.name.length>maxC?a.node.name.slice(0,maxC-1)+'…':a.node.name;
      const fs=Math.max(4,Math.min(7,nr*0.48));
      ctx.font=`${act?'600':'500'} ${fs}px "Libre Franklin"`;
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillStyle=`rgba(35,30,25,${(act?0.9:hit?0.8:0.55)*pulse})`;
      ctx.fillText(label,wx,wy,nr*1.6);
      ctx.textBaseline='alphabetic';
    }

    ctx.restore();
    requestAnimationFrame(draw);
  }

  // ═══ CANVAS INTERACTION ═══
  function setupCanvas(){
    const dpr=()=>Math.min(window.devicePixelRatio||1,1.5);
    canvas.addEventListener('click',e=>{if(state.dragging)return;wakePhysics();const p=stw(e.clientX,e.clientY);let cl=null,cd=30/state.transform.scale;state.particles.forEach(a=>{const d=Math.hypot(p.x-a.x,p.y-a.y);if(d<cd){cl=a;cd=d;}});if(cl)openPanel(cl.node);else closePanel();});
    canvas.addEventListener('mousemove',e=>{if(state.dragging)return;const p=stw(e.clientX,e.clientY);state.hoverNode=null;state.particles.forEach(a=>{if(Math.hypot(p.x-a.x,p.y-a.y)<20/state.transform.scale)state.hoverNode=a;});canvas.style.cursor=state.hoverNode?'pointer':'default';if(state.hoverNode)wakePhysics();});
    canvas.addEventListener('mousedown',e=>{if(e.button!==0)return;state.dragging=false;state.dragStart={x:e.clientX,y:e.clientY};state.dragTransStart={x:state.transform.x,y:state.transform.y};const onM=ev=>{const dx=ev.clientX-state.dragStart.x,dy=ev.clientY-state.dragStart.y;if(Math.abs(dx)+Math.abs(dy)>5)state.dragging=true;state.transform.x=state.dragTransStart.x+dx*dpr();state.transform.y=state.dragTransStart.y+dy*dpr();};const onU=()=>{document.removeEventListener('mousemove',onM);document.removeEventListener('mouseup',onU);setTimeout(()=>state.dragging=false,50);};document.addEventListener('mousemove',onM);document.addEventListener('mouseup',onU);});
    canvas.addEventListener('wheel',e=>{e.preventDefault();wakePhysics();const f=e.deltaY>0?.92:1.08,ns=Math.max(.15,Math.min(5,state.transform.scale*f));const r=canvas.getBoundingClientRect(),mx=(e.clientX-r.left)*dpr(),my=(e.clientY-r.top)*dpr();state.transform.x=mx-(mx-state.transform.x)*(ns/state.transform.scale);state.transform.y=my-(my-state.transform.y)*(ns/state.transform.scale);state.transform.scale=ns;},{passive:false});
    let ltd=0;
    canvas.addEventListener('touchstart',e=>{wakePhysics();if(e.touches.length===1){state.dragStart={x:e.touches[0].clientX,y:e.touches[0].clientY};state.dragTransStart={x:state.transform.x,y:state.transform.y};}if(e.touches.length===2)ltd=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);},{passive:true});
    canvas.addEventListener('touchmove',e=>{const d=dpr();if(e.touches.length===1){state.transform.x=state.dragTransStart.x+(e.touches[0].clientX-state.dragStart.x)*d;state.transform.y=state.dragTransStart.y+(e.touches[0].clientY-state.dragStart.y)*d;}if(e.touches.length===2){const nd=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);state.transform.scale=Math.max(.15,Math.min(5,state.transform.scale*nd/ltd));ltd=nd;}},{passive:true});
  }
  function stw(sx,sy){const r=canvas.getBoundingClientRect(),d=Math.min(window.devicePixelRatio||1,1.5);return{x:((sx-r.left)*d-state.transform.x)/state.transform.scale,y:((sy-r.top)*d-state.transform.y)/state.transform.scale};}

  // ═══ NODE PANEL ═══
  function openPanel(n){
    state.activeNode=n;wakePhysics();
    document.getElementById('npCat').textContent=n.category.toUpperCase();
    document.getElementById('npName').textContent=n.name;
    document.getElementById('npTags').textContent=(n.tags||[]).map(t=>'#'+t).join('  ');
    document.getElementById('npNotes').textContent=n.notes||'';
    // Sources
    const se=document.getElementById('npSources');se.innerHTML='';
    const src=n.sources||n.source_emails;
    if(src&&Array.isArray(src)&&src.length){
      se.innerHTML='<div class="np-sources-title">SOURCES</div>';
      src.forEach(s=>{const d=document.createElement('div');d.className='np-source';d.innerHTML=`<div class="np-source-from">${s.from||''}</div><div class="np-source-subject">${s.subject||''}</div><div class="np-source-date">${s.date||''}</div>`;se.appendChild(d);});
    }
    // Attachments
    const ae=document.getElementById('npAttachments');
    if(ae){ae.innerHTML='';
      const att=n.attachments;
      if(att&&Array.isArray(att)&&att.length){
        ae.innerHTML='<div class="np-sources-title">ATTACHMENTS</div>';
        att.forEach(a=>{const d=document.createElement('a');d.className='np-attachment';d.href=a.url;d.target='_blank';
          d.innerHTML=`<span class="np-att-icon">${a.type&&a.type.includes('pdf')?'📄':a.type&&a.type.includes('image')?'🖼':'📎'}</span><span class="np-att-name">${a.filename||'file'}</span>`;
          ae.appendChild(d);});
      }
    }
    // Links
    const le=document.getElementById('npLinks');le.innerHTML='';
    if(n.links&&n.links.length){
      le.innerHTML='<div style="font-size:9px;letter-spacing:1px;color:var(--faint);margin-bottom:4px">CONNECTED TO</div>';
      n.links.forEach(lid=>{const ln=NX.nodes.find(x=>x.id===lid);if(ln){const d=document.createElement('div');d.textContent='→ '+ln.name;d.style.cssText='padding:5px 0;cursor:pointer;color:var(--accent);font-size:13px';d.onclick=()=>openPanel(ln);le.appendChild(d);}});
    }
    document.getElementById('nodePanel').classList.add('open');
  }
  function closePanel(){state.activeNode=null;document.getElementById('nodePanel').classList.remove('open');}
  function checkEmpty(){const e=document.getElementById('canvasEmpty');if(e)e.style.display=NX.nodes.length<=1?'flex':'none';}

  function init(){
    resize();buildParticles();
    for(let i=0;i<200;i++)physics();
    setupCanvas();checkEmpty();
    if(NX.brain.initChat)NX.brain.initChat();
    if(NX.brain.initList)NX.brain.initList();
    if(NX.brain.initEvents)NX.brain.initEvents();
    draw();
  }

  NX.brain={init,closePanel,state,wakePhysics,cc,show:()=>{resize();},openPanel};
  NX.modules.brain=NX.brain;NX.loaded.brain=true;
})();
