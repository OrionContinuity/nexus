/* NEXUS Brain Canvas v11 — Thousands of tiny dots, galaxy orbits */
(function(){
  const canvas=document.getElementById('brainCanvas'),ctx=canvas.getContext('2d');
  let W,H,time=0,physicsFrame=0;

  const state={
    particles:[],transform:{x:0,y:0,scale:1},
    dragging:false,dragStart:{x:0,y:0},dragTransStart:{x:0,y:0},
    hoverNode:null,activeNode:null,frozenNode:null,
    activatedNodes:new Set(),searchHits:new Set(),
    linkMap:{},catMap:{},tagSets:{},
    contractorEvents:[],W:0,H:0,canvas,ctx
  };

  const DAMP=0.993,MAXV=1.0;
  const DOT=3,DOT_HIT=6,DOT_ACTIVE=10;

  function resize(){
    const r=canvas.getBoundingClientRect();
    const dpr=Math.min(window.devicePixelRatio||1,1.5);
    W=r.width*dpr;H=r.height*dpr;
    canvas.width=W;canvas.height=H;
    canvas.style.width=r.width+'px';canvas.style.height=r.height+'px';
    state.W=W;state.H=H;
  }
  window.addEventListener('resize',()=>{if(document.getElementById('brainView').classList.contains('active'))resize();});

  // ═══ GALAXY PLACEMENT ═══
  function buildParticles(){
    const nodes=NX.nodes.filter(n=>!n.is_private),cx=W/2,cy=H/2;
    const ARMS=4,galaxyR=Math.min(W,H)*0.42;
    state.particles=nodes.map((n,idx)=>{
      const arm=idx%ARMS;
      const armBase=(arm/ARMS)*Math.PI*2;
      const t=idx/nodes.length;
      const r=30+Math.pow(t,0.65)*galaxyR;
      const wind=armBase+t*5+(Math.random()-0.5)*1.0;
      const scatter=(Math.random()-0.5)*45*(0.4+t);
      const px=cx+Math.cos(wind)*r+Math.cos(wind+1.57)*scatter;
      const py=cy+Math.sin(wind)*r+Math.sin(wind+1.57)*scatter;
      const speed=2.0/Math.sqrt(Math.max(r/galaxyR,0.08));
      return{id:n.id,x:px,y:py,
        vx:-(py-cy)/(r||1)*speed*0.012,
        vy:(px-cx)/(r||1)*speed*0.012,
        node:n,cat:n.category,tags:n.tags||[],links:n.links||[],access:n.access_count||1};
    });
    state.linkMap={};state.catMap={};state.tagSets={};
    state.particles.forEach((p,i)=>{
      state.linkMap[p.id]=p;
      if(!state.catMap[p.cat])state.catMap[p.cat]=[];
      state.catMap[p.cat].push(i);
      state.tagSets[i]=new Set(p.tags);
    });
  }

  // ═══ PHYSICS — pure orbital, no hover gravity ═══
  function physics(){
    const P=state.particles,len=P.length,cx=W/2,cy=H/2;
    const galaxyR=Math.min(W,H)*0.42;
    const CELL=40,grid=new Map();

    for(let i=0;i<len;i++){
      const a=P[i];
      const key=((Math.floor(a.x/CELL)+500)<<16)|(Math.floor(a.y/CELL)+500);
      let c=grid.get(key);if(!c){c=[];grid.set(key,c);}c.push(i);
    }

    for(let i=0;i<len;i++){
      const a=P[i];
      // Frozen node — no physics
      if(state.frozenNode&&state.frozenNode.id===a.id)continue;

      const dx=a.x-cx,dy=a.y-cy;
      const dist=Math.sqrt(dx*dx+dy*dy)||1;

      // Orbital force
      const orbF=0.1/Math.sqrt(Math.max(dist/galaxyR,0.05));
      const tx=-dy/dist,ty=dx/dist;
      a.vx+=tx*orbF;a.vy+=ty*orbF;

      // Slingshot
      if(dist<20){const s=12*(1-dist/20);a.vx+=dx/dist*s;a.vy+=dy/dist*s;}

      // Gentle inward pull
      a.vx-=dx/dist*0.0006;a.vy-=dy/dist*0.0006;

      // Boundary
      if(dist>galaxyR*1.3){const o=(dist-galaxyR*1.3)*0.003;a.vx-=dx/dist*o;a.vy-=dy/dist*o;}

      // Overlap — only immediate neighbors, very soft
      const gx=Math.floor(a.x/CELL)+500,gy=Math.floor(a.y/CELL)+500;
      for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++){
        const nb=grid.get(((gx+ox)<<16)|(gy+oy));if(!nb)continue;
        for(let ni=0;ni<nb.length;ni++){
          const j=nb[ni];if(j<=i)continue;
          const b=P[j];const ddx=a.x-b.x,ddy=a.y-b.y;
          const dd=Math.sqrt(ddx*ddx+ddy*ddy)||1;
          if(dd<DOT*3){const push=(DOT*3-dd)*0.05;
            a.vx+=ddx/dd*push;a.vy+=ddy/dd*push;
            b.vx-=ddx/dd*push;b.vy-=ddy/dd*push;}
        }
      }

      a.vx*=DAMP;a.vy*=DAMP;
      const sp=a.vx*a.vx+a.vy*a.vy;
      if(dist>25&&sp>MAXV*MAXV){const s=Math.sqrt(sp);a.vx=a.vx/s*MAXV;a.vy=a.vy/s*MAXV;}
      a.x+=a.vx;a.y+=a.vy;
    }
  }

  // ═══ RENDER ═══
  function draw(){
    time+=0.005;physicsFrame++;
    const P=state.particles,t=state.transform;
    if(P.length<800||physicsFrame%2===0)physics();

    ctx.save();
    ctx.fillStyle='#08080c';ctx.fillRect(0,0,W,H);
    ctx.translate(t.x,t.y);ctx.scale(t.scale,t.scale);

    const cx=W/2,cy=H/2;
    const isA=state.activatedNodes.size>0||state.searchHits.size>0;
    const invS=1/t.scale;
    const vl=-t.x*invS-50,vr=(-t.x+W)*invS+50;
    const vt=-t.y*invS-50,vb=(-t.y+H)*invS+50;

    // ═══ GOLD CONNECTION LINES — only for search hits / activated ═══
    if(isA){
      ctx.lineWidth=1.2;ctx.strokeStyle='rgba(212,182,138,.4)';
      for(let i=0;i<P.length;i++){
        const a=P[i];
        const aHit=state.searchHits.has(a.id)||state.activatedNodes.has(a.id);
        if(!aHit)continue;
        // Line to center
        ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(a.x,a.y);ctx.stroke();
        // Lines to linked nodes
        for(let li=0;li<a.links.length;li++){
          const b=state.linkMap[a.links[li]];if(!b)continue;
          ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
        }
      }
    }

    // ═══ NEXUS BEACON ═══
    const br=Math.sin(time*1.1),beaconR=40+br*3;
    ctx.beginPath();ctx.arc(cx,cy,beaconR*2,0,Math.PI*2);
    ctx.fillStyle='rgba(212,182,138,.02)';ctx.fill();
    ctx.beginPath();ctx.arc(cx,cy,beaconR*1.4,0,Math.PI*2);
    ctx.fillStyle='rgba(212,182,138,.04)';ctx.fill();
    ctx.shadowBlur=25;ctx.shadowColor='rgba(212,182,138,.5)';
    ctx.beginPath();ctx.arc(cx,cy,beaconR,0,Math.PI*2);
    ctx.fillStyle='#0c0c10';ctx.fill();
    ctx.strokeStyle=`rgba(212,182,138,${.5+br*.15})`;ctx.lineWidth=1.8;ctx.stroke();
    ctx.shadowBlur=0;
    ctx.fillStyle=`rgba(212,182,138,${.75+br*.1})`;
    ctx.font='500 13px "JetBrains Mono"';ctx.textAlign='center';ctx.fillText('NEXUS',cx,cy+4);

    // ═══ DOTS ═══
    for(let i=0;i<P.length;i++){
      const a=P[i];
      if(a.x<vl||a.x>vr||a.y<vt||a.y>vb)continue;

      const isHit=state.searchHits.has(a.id)||state.activatedNodes.has(a.id);
      const isActive=state.activeNode&&state.activeNode.id===a.id;
      const isFrozen=state.frozenNode&&state.frozenNode.id===a.id;
      const isHover=state.hoverNode&&state.hoverNode.id===a.id;
      const dim=isA&&!isHit&&!isActive;

      const pulse=0.85+0.15*Math.sin(time*1.3+a.id*0.9);

      if(isActive||isFrozen){
        // ACTIVE/FROZEN — gold circle with gold hue
        const r=DOT_ACTIVE;
        // Outer hue
        ctx.beginPath();ctx.arc(a.x,a.y,r*3,0,Math.PI*2);
        ctx.fillStyle='rgba(212,182,138,.06)';ctx.fill();
        // Gold ring
        ctx.beginPath();ctx.arc(a.x,a.y,r,0,Math.PI*2);
        ctx.fillStyle='rgba(255,250,240,.9)';ctx.fill();
        ctx.strokeStyle='rgba(212,182,138,.7)';ctx.lineWidth=2;ctx.stroke();
        // Label
        ctx.font='500 11px "Libre Franklin"';ctx.textAlign='center';
        ctx.fillStyle='rgba(212,182,138,.9)';
        ctx.fillText(a.node.name,a.x,a.y-r-6);
      }else if(isHit){
        // SEARCH HIT — gold glow dot
        const r=DOT_HIT*pulse;
        ctx.beginPath();ctx.arc(a.x,a.y,r*2.5,0,Math.PI*2);
        ctx.fillStyle='rgba(212,182,138,.05)';ctx.fill();
        ctx.beginPath();ctx.arc(a.x,a.y,r,0,Math.PI*2);
        ctx.fillStyle='rgba(255,248,235,.8)';ctx.fill();
        ctx.strokeStyle='rgba(212,182,138,.5)';ctx.lineWidth=1.2;ctx.stroke();
        // Label
        ctx.font='400 10px "Libre Franklin"';ctx.textAlign='center';
        ctx.fillStyle='rgba(212,182,138,.8)';
        ctx.fillText(a.node.name.slice(0,25),a.x,a.y-r-5);
      }else if(isHover){
        // HOVER — slight enlarge + label
        const r=DOT*1.8;
        ctx.beginPath();ctx.arc(a.x,a.y,r*2,0,Math.PI*2);
        ctx.fillStyle='rgba(212,182,138,.04)';ctx.fill();
        ctx.beginPath();ctx.arc(a.x,a.y,r,0,Math.PI*2);
        ctx.fillStyle='rgba(240,238,230,.7)';ctx.fill();
        ctx.strokeStyle='rgba(212,182,138,.3)';ctx.lineWidth=0.8;ctx.stroke();
        ctx.font='400 10px "Libre Franklin"';ctx.textAlign='center';
        ctx.fillStyle='rgba(212,182,138,.7)';
        ctx.fillText(a.node.name.slice(0,25),a.x,a.y-r-5);
      }else{
        // NORMAL DOT — tiny, no label
        const r=DOT*pulse;
        const alpha=dim?0.06:0.35;
        ctx.beginPath();ctx.arc(a.x,a.y,r,0,Math.PI*2);
        ctx.fillStyle=`rgba(220,215,205,${alpha*pulse})`;ctx.fill();
      }
    }

    ctx.restore();
    requestAnimationFrame(draw);
  }

  // ═══ INTERACTION — tap freezes ONE node only ═══
  function setupCanvas(){
    const dpr=()=>Math.min(window.devicePixelRatio||1,1.5);

    canvas.addEventListener('click',e=>{
      if(state.dragging)return;
      const p=stw(e.clientX,e.clientY);
      let closest=null,closestD=25/state.transform.scale;
      state.particles.forEach(a=>{
        const d=Math.hypot(p.x-a.x,p.y-a.y);
        if(d<closestD){closest=a;closestD=d;}
      });
      if(closest){
        // Freeze only this node
        if(state.frozenNode&&state.frozenNode.id===closest.id){
          // Tap again to unfreeze
          state.frozenNode=null;state.activeNode=null;
          closePanel();
        }else{
          state.frozenNode=closest;
          state.activeNode=closest.node;
          openPanel(closest.node);
        }
      }else{
        state.frozenNode=null;state.activeNode=null;
        closePanel();
      }
    });

    canvas.addEventListener('mousemove',e=>{
      if(state.dragging)return;
      const p=stw(e.clientX,e.clientY);
      state.hoverNode=null;
      state.particles.forEach(a=>{
        if(Math.hypot(p.x-a.x,p.y-a.y)<15/state.transform.scale)state.hoverNode=a;
      });
      canvas.style.cursor=state.hoverNode?'pointer':'default';
    });

    canvas.addEventListener('mousedown',e=>{
      if(e.button!==0)return;state.dragging=false;
      state.dragStart={x:e.clientX,y:e.clientY};
      state.dragTransStart={x:state.transform.x,y:state.transform.y};
      const onM=ev=>{
        const dx=ev.clientX-state.dragStart.x,dy=ev.clientY-state.dragStart.y;
        if(Math.abs(dx)+Math.abs(dy)>5)state.dragging=true;
        state.transform.x=state.dragTransStart.x+dx*dpr();
        state.transform.y=state.dragTransStart.y+dy*dpr();
      };
      const onU=()=>{document.removeEventListener('mousemove',onM);document.removeEventListener('mouseup',onU);setTimeout(()=>state.dragging=false,50);};
      document.addEventListener('mousemove',onM);document.addEventListener('mouseup',onU);
    });

    canvas.addEventListener('wheel',e=>{
      e.preventDefault();
      const f=e.deltaY>0?.92:1.08;
      const ns=Math.max(.1,Math.min(8,state.transform.scale*f));
      const r=canvas.getBoundingClientRect();
      const mx=(e.clientX-r.left)*dpr(),my=(e.clientY-r.top)*dpr();
      state.transform.x=mx-(mx-state.transform.x)*(ns/state.transform.scale);
      state.transform.y=my-(my-state.transform.y)*(ns/state.transform.scale);
      state.transform.scale=ns;
    },{passive:false});

    let ltd=0;
    canvas.addEventListener('touchstart',e=>{
      if(e.touches.length===1){state.dragStart={x:e.touches[0].clientX,y:e.touches[0].clientY};state.dragTransStart={x:state.transform.x,y:state.transform.y};}
      if(e.touches.length===2)ltd=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
    },{passive:true});
    canvas.addEventListener('touchmove',e=>{
      const d=dpr();
      if(e.touches.length===1){state.transform.x=state.dragTransStart.x+(e.touches[0].clientX-state.dragStart.x)*d;state.transform.y=state.dragTransStart.y+(e.touches[0].clientY-state.dragStart.y)*d;}
      if(e.touches.length===2){const nd=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);state.transform.scale=Math.max(.1,Math.min(8,state.transform.scale*nd/ltd));ltd=nd;}
    },{passive:true});
  }

  function stw(sx,sy){const r=canvas.getBoundingClientRect(),d=Math.min(window.devicePixelRatio||1,1.5);return{x:((sx-r.left)*d-state.transform.x)/state.transform.scale,y:((sy-r.top)*d-state.transform.y)/state.transform.scale};}

  // ═══ NODE PANEL ═══
  function openPanel(n){
    state.activeNode=n;
    document.getElementById('npCat').textContent=n.category.toUpperCase();
    document.getElementById('npName').textContent=n.name;
    document.getElementById('npTags').textContent=(n.tags||[]).map(t=>'#'+t).join('  ');
    document.getElementById('npNotes').textContent=n.notes||'No notes.';

    // ═══ SOURCES — expandable email cards ═══
    const se=document.getElementById('npSources');se.innerHTML='';
    const src=n.sources||n.source_emails;
    if(src&&Array.isArray(src)&&src.length){
      se.innerHTML='<div class="np-section-title">SOURCES ('+src.length+')</div>';
      src.forEach((s,si)=>{
        const card=document.createElement('div');card.className='np-email-card';
        const header=document.createElement('div');header.className='np-email-header';
        header.innerHTML=`<div class="np-email-from">${s.from||'Unknown'}</div><div class="np-email-date">${s.date||''}</div>`;
        const subject=document.createElement('div');subject.className='np-email-subject';
        subject.textContent=s.subject||'No subject';
        card.appendChild(header);card.appendChild(subject);
        // Expandable body
        if(s.body||s.snippet){
          const toggle=document.createElement('button');toggle.className='np-email-toggle';toggle.textContent='View full email ▼';
          const body=document.createElement('div');body.className='np-email-body';body.style.display='none';
          body.textContent=s.body||s.snippet||'';
          toggle.addEventListener('click',()=>{
            const open=body.style.display!=='none';
            body.style.display=open?'none':'block';
            toggle.textContent=open?'View full email ▼':'Collapse ▲';
          });
          card.appendChild(toggle);card.appendChild(body);
        }
        se.appendChild(card);
      });
    }

    // ═══ ATTACHMENTS — with image previews ═══
    const ae=document.getElementById('npAttachments');ae.innerHTML='';
    const att=n.attachments;
    if(att&&Array.isArray(att)&&att.length){
      ae.innerHTML='<div class="np-section-title">ATTACHMENTS ('+att.length+')</div>';
      att.forEach(a=>{
        const isImage=a.type&&(a.type.includes('image')||/\.(jpg|jpeg|png|gif|webp)$/i.test(a.filename||''));
        const card=document.createElement('div');card.className='np-att-card';
        if(isImage&&a.url){
          const img=document.createElement('img');img.className='np-att-preview';img.src=a.url;img.alt=a.filename||'image';
          img.addEventListener('click',()=>window.open(a.url,'_blank'));
          card.appendChild(img);
        }
        const info=document.createElement('a');info.className='np-att-info';info.href=a.url||'#';info.target='_blank';
        const icon=a.type&&a.type.includes('pdf')?'📄':isImage?'🖼':'📎';
        info.innerHTML=`<span class="np-att-icon">${icon}</span><div class="np-att-details"><div class="np-att-name">${a.filename||'file'}</div><div class="np-att-meta">${a.from?'From: '+a.from:''} ${a.date||''}</div></div>`;
        card.appendChild(info);
        ae.appendChild(card);
      });
    }

    // ═══ CONNECTED NODES ═══
    const le=document.getElementById('npLinks');le.innerHTML='';
    if(n.links&&n.links.length){
      le.innerHTML='<div class="np-section-title">CONNECTED TO ('+n.links.length+')</div>';
      n.links.forEach(lid=>{
        const ln=NX.nodes.find(x=>x.id===lid);if(!ln)return;
        const d=document.createElement('div');d.className='np-link-item';
        d.innerHTML=`<span class="np-link-cat">${ln.category}</span>${ln.name}`;
        d.onclick=()=>{const fp=state.particles.find(p=>p.id===lid);if(fp){state.frozenNode=fp;state.activeNode=ln;openPanel(ln);}};
        le.appendChild(d);
      });
    }

    // ═══ DELETE NODE ═══
    const delBtn=document.getElementById('npDelete');
    delBtn.onclick=async()=>{
      if(!confirm('Delete "'+n.name+'" permanently?'))return;
      delBtn.disabled=true;delBtn.textContent='Deleting...';
      try{
        const{error}=await NX.sb.from('nodes').delete().eq('id',n.id);
        if(!error){
          NX.nodes=NX.nodes.filter(x=>x.id!==n.id);
          state.particles=state.particles.filter(p=>p.id!==n.id);
          delete state.linkMap[n.id];
          closePanel();
        }else{delBtn.textContent='Error: '+error.message;}
      }catch(e){delBtn.textContent='Error';}
      setTimeout(()=>{delBtn.disabled=false;delBtn.textContent='Delete Node';},3000);
    };

    document.getElementById('nodePanel').classList.add('open');
    if(window.lucide)lucide.createIcons();
  }

  function closePanel(){state.activeNode=null;state.frozenNode=null;document.getElementById('nodePanel').classList.remove('open');}
  function checkEmpty(){const e=document.getElementById('canvasEmpty');if(e)e.style.display=NX.nodes.length<=1?'flex':'none';}
  function wakePhysics(){}// no-op, always running

  function init(){
    resize();buildParticles();
    for(let i=0;i<150;i++)physics();
    setupCanvas();checkEmpty();
    if(NX.brain.initChat)NX.brain.initChat();
    if(NX.brain.initList)NX.brain.initList();
    if(NX.brain.initEvents)NX.brain.initEvents();
    draw();
  }

  NX.brain={init,closePanel,state,wakePhysics,show:()=>{resize();},openPanel};
  NX.modules.brain=NX.brain;NX.loaded.brain=true;
})();
