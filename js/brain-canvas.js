/* NEXUS Brain Canvas v12 — Galaxy + Nebula + Audio
   Tap the NEXUS beacon to activate ambient audio + particle effects
*/
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

  const DAMP=0.993,MAXV=1.0,DOT=3,DOT_HIT=6,DOT_ACTIVE=10;

  // ═══ NEBULA PARTICLES — beacon-001 inspired ═══
  const nebula=[];const MAX_NEBULA=300;
  const NEBULA_COLORS=[
    [212,182,138],[220,195,155],[245,230,200],[180,160,130],
    [200,175,140],[230,210,170],[190,170,145],[255,240,210],
    [170,150,120],[240,220,180]
  ];

  function spawnNebula(cx,cy,energy){
    if(nebula.length>=MAX_NEBULA)return;
    const angle=Math.random()*Math.PI*2;
    const speed=0.15+Math.random()*0.6+(energy||0)*1.5;
    const c=NEBULA_COLORS[Math.floor(Math.random()*NEBULA_COLORS.length)];
    nebula.push({
      x:cx,y:cy,
      vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,
      life:1,decay:0.001+Math.random()*0.002, // Very slow decay — long life
      size:0.8+Math.random()*2.5+(energy||0)*2,
      color:c,fromCenter:true,age:0,
      wobbleSpeed:0.2+Math.random()*0.8,wobblePhase:Math.random()*6.28,wobbleAmp:0.8+Math.random()*3,
      pulseSpeed:0.15+Math.random()*0.4,pulsePhase:Math.random()*6.28,
      baseAlpha:0.08+Math.random()*0.18
    });
  }

  function updateNebula(){
    for(let i=nebula.length-1;i>=0;i--){
      const p=nebula[i];
      p.age++;p.life-=p.decay;
      if(p.life<=0){nebula.splice(i,1);continue;}
      const wobble=Math.sin(time*p.wobbleSpeed*60+p.wobblePhase)*p.wobbleAmp;
      const perpLen=Math.sqrt(p.vx*p.vx+p.vy*p.vy)||1;
      // Music pushes particles outward
      if(p.fromCenter&&isPlaying){p.vx+=p.vx*0.0003*audioEnergy;p.vy+=p.vy*0.0003*audioEnergy;}
      else if(!isPlaying&&p.fromCenter){p.vx*=0.999;p.vy*=0.999;}
      p.x+=p.vx+wobble*(-p.vy/perpLen)*0.15;
      p.y+=p.vy+wobble*(p.vx/perpLen)*0.15;
    }
  }

  function drawNebula(){
    for(let i=0;i<nebula.length;i++){
      const p=nebula[i];
      const pulse=0.7+0.3*Math.sin(time*p.pulseSpeed*60+p.pulsePhase);
      const fadeIn=Math.min(p.age/60,1);
      const fadeOut=Math.pow(p.life,0.6);
      const musicGlow=p.fromCenter&&isPlaying?(1+audioEnergy*1.5):1;
      const a=Math.min(p.baseAlpha*fadeIn*fadeOut*musicGlow*pulse,0.5);
      if(a<0.004)continue;
      const sz=p.size*pulse;
      const bassSize=isPlaying?sz+audioBass*2:sz;
      const c=p.color;
      // Triple layer — beacon style
      ctx.beginPath();ctx.arc(p.x,p.y,bassSize*4,0,Math.PI*2);
      ctx.fillStyle=`rgba(${c[0]},${c[1]},${c[2]},${a*0.12})`;ctx.fill();
      ctx.beginPath();ctx.arc(p.x,p.y,bassSize*2,0,Math.PI*2);
      ctx.fillStyle=`rgba(${c[0]},${c[1]},${c[2]},${a*0.3})`;ctx.fill();
      ctx.beginPath();ctx.arc(p.x,p.y,bassSize,0,Math.PI*2);
      ctx.fillStyle=`rgba(${c[0]},${c[1]},${c[2]},${a})`;ctx.fill();
    }
  }

  // ═══ AUDIO — MP3 playback with Web Audio analyzer ═══
  let audioCtx=null,analyser=null,masterGain=null,audioEl=null,sourceNode=null;
  let isPlaying=false,audioEnergy=0,audioBass=0,audioTreble=0;
  const freqData=new Uint8Array(128);

  function initAudio(){
    audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    analyser=audioCtx.createAnalyser();analyser.fftSize=256;
    masterGain=audioCtx.createGain();masterGain.gain.value=0;
    masterGain.connect(analyser);analyser.connect(audioCtx.destination);

    audioEl=document.createElement('audio');
    audioEl.src='beacon-audio.mp3';audioEl.loop=true;audioEl.crossOrigin='anonymous';
    sourceNode=audioCtx.createMediaElementSource(audioEl);
    sourceNode.connect(masterGain);
  }

  function fadeIn(){
    if(!audioCtx)return;
    const now=audioCtx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value,now);
    masterGain.gain.linearRampToValueAtTime(0.85,now+3);
  }

  function fadeOut(cb){
    if(!audioCtx){if(cb)cb();return;}
    const now=audioCtx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value,now);
    masterGain.gain.linearRampToValueAtTime(0,now+2);
    if(cb)setTimeout(cb,2100);
  }

  function updateAudio(){
    if(!analyser||!isPlaying)return;
    analyser.getByteFrequencyData(freqData);
    let sum=0,bass=0,treble=0;
    for(let i=0;i<freqData.length;i++){
      sum+=freqData[i];
      if(i<20)bass+=freqData[i];
      if(i>80)treble+=freqData[i];
    }
    audioEnergy=sum/(freqData.length*255);
    audioBass=bass/(20*255);
    audioTreble=treble/(48*255);
  }

  function togglePlay(cx,cy){
    if(isPlaying){
      fadeOut(()=>{audioEl.pause();isPlaying=false;});
    }else{
      if(!audioCtx)initAudio();
      const resume=audioCtx.state==='suspended'?audioCtx.resume():Promise.resolve();
      resume.then(()=>{
        const p=audioEl.play();
        const start=()=>{isPlaying=true;fadeIn();for(let i=0;i<40;i++)spawnNebula(cx,cy,0.6);};
        if(p&&p.then)p.then(start).catch(e=>{console.error('Play failed:',e);setTimeout(()=>audioEl.play().then(start).catch(()=>{}),200);});
        else start();
      });
    }
  }

  // ═══ GALAXY PLACEMENT ═══
  function resize(){
    const r=canvas.getBoundingClientRect();
    const dpr=Math.min(window.devicePixelRatio||1,1.5);
    W=r.width*dpr;H=r.height*dpr;canvas.width=W;canvas.height=H;
    canvas.style.width=r.width+'px';canvas.style.height=r.height+'px';
    state.W=W;state.H=H;
  }
  window.addEventListener('resize',()=>{if(document.getElementById('brainView').classList.contains('active'))resize();});

  function buildParticles(){
    const nodes=NX.nodes.filter(n=>!n.is_private),cx=W/2,cy=H/2;
    const ARMS=4,galaxyR=Math.min(W,H)*0.42;
    state.particles=nodes.map((n,idx)=>{
      const arm=idx%ARMS,armBase=(arm/ARMS)*Math.PI*2;
      const t=idx/nodes.length,r=30+Math.pow(t,0.65)*galaxyR;
      const wind=armBase+t*5+(Math.random()-0.5)*1.0;
      const scatter=(Math.random()-0.5)*45*(0.4+t);
      const px=cx+Math.cos(wind)*r+Math.cos(wind+1.57)*scatter;
      const py=cy+Math.sin(wind)*r+Math.sin(wind+1.57)*scatter;
      const speed=2.0/Math.sqrt(Math.max(r/galaxyR,0.08));
      return{id:n.id,x:px,y:py,vx:-(py-cy)/(r||1)*speed*0.012,vy:(px-cx)/(r||1)*speed*0.012,
        node:n,cat:n.category,tags:n.tags||[],links:n.links||[],access:n.access_count||1};
    });
    state.linkMap={};state.catMap={};state.tagSets={};
    state.particles.forEach((p,i)=>{state.linkMap[p.id]=p;if(!state.catMap[p.cat])state.catMap[p.cat]=[];state.catMap[p.cat].push(i);state.tagSets[i]=new Set(p.tags);});
  }

  // ═══ PHYSICS ═══
  function physics(){
    const P=state.particles,len=P.length,cx=W/2,cy=H/2;
    const galaxyR=Math.min(W,H)*0.42,CELL=40,grid=new Map();
    for(let i=0;i<len;i++){const a=P[i];const key=((Math.floor(a.x/CELL)+500)<<16)|(Math.floor(a.y/CELL)+500);let c=grid.get(key);if(!c){c=[];grid.set(key,c);}c.push(i);}
    for(let i=0;i<len;i++){const a=P[i];
      if(state.frozenNode&&state.frozenNode.id===a.id)continue;
      const dx=a.x-cx,dy=a.y-cy,dist=Math.sqrt(dx*dx+dy*dy)||1;
      // Orbital
      const orbF=0.1/Math.sqrt(Math.max(dist/galaxyR,0.05));
      a.vx+=(-dy/dist)*orbF;a.vy+=(dx/dist)*orbF;
      // Slingshot
      if(dist<20){const s=12*(1-dist/20);a.vx+=dx/dist*s;a.vy+=dy/dist*s;}
      // Inward pull
      a.vx-=dx/dist*0.0006;a.vy-=dy/dist*0.0006;
      // Boundary
      if(dist>galaxyR*1.3){const o=(dist-galaxyR*1.3)*0.003;a.vx-=dx/dist*o;a.vy-=dy/dist*o;}
      // Audio push — music makes nodes drift outward slightly
      if(isPlaying&&audioEnergy>0.1){a.vx+=dx/dist*audioEnergy*0.02;a.vy+=dy/dist*audioEnergy*0.02;}
      // Overlap
      const gx=Math.floor(a.x/CELL)+500,gy=Math.floor(a.y/CELL)+500;
      for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++){const nb=grid.get(((gx+ox)<<16)|(gy+oy));if(!nb)continue;for(let ni=0;ni<nb.length;ni++){const j=nb[ni];if(j<=i)continue;const b=P[j];const ddx=a.x-b.x,ddy=a.y-b.y,dd=Math.sqrt(ddx*ddx+ddy*ddy)||1;if(dd<DOT*3){const push=(DOT*3-dd)*0.05;a.vx+=ddx/dd*push;a.vy+=ddy/dd*push;b.vx-=ddx/dd*push;b.vy-=ddy/dd*push;}}}
      a.vx*=DAMP;a.vy*=DAMP;const sp=a.vx*a.vx+a.vy*a.vy;
      if(dist>25&&sp>MAXV*MAXV){const s=Math.sqrt(sp);a.vx=a.vx/s*MAXV;a.vy=a.vy/s*MAXV;}
      a.x+=a.vx;a.y+=a.vy;
    }
  }

  // ═══ RENDER ═══
  function draw(){
    time+=0.005;physicsFrame++;
    const P=state.particles,t=state.transform;
    if(P.length<800||physicsFrame%2===0)physics();
    updateAudio();

    // Spawn nebula particles — gentler, slower
    const cx=W/2,cy=H/2;
    const galaxyR=Math.min(W,H)*0.42;
    if(isPlaying){
      const spawnRate=1+Math.floor(audioEnergy*4);
      for(let i=0;i<spawnRate;i++)spawnNebula(cx,cy,audioEnergy);
    }else if(Math.random()<0.05){
      spawnNebula(cx,cy,0); // Very occasional idle particle
    }
    updateNebula();

    ctx.save();
    ctx.fillStyle='#08080c';ctx.fillRect(0,0,W,H);
    ctx.translate(t.x,t.y);ctx.scale(t.scale,t.scale);

    const isA=state.activatedNodes.size>0||state.searchHits.size>0;
    const invS=1/t.scale;
    const vl=-t.x*invS-50,vr=(-t.x+W)*invS+50;
    const vt=-t.y*invS-50,vb=(-t.y+H)*invS+50;

    // Nebula particles (behind everything)
    drawNebula(t);

    // Gold connection lines
    if(isA){
      ctx.lineWidth=1.2;ctx.strokeStyle='rgba(212,182,138,.4)';
      for(let i=0;i<P.length;i++){const a=P[i];
        if(!(state.searchHits.has(a.id)||state.activatedNodes.has(a.id)))continue;
        ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(a.x,a.y);ctx.stroke();
        for(let li=0;li<a.links.length;li++){const b=state.linkMap[a.links[li]];if(!b)continue;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
      }
    }

    // ═══ NEXUS BEACON — smaller, glowing, secret ═══
    const br=Math.sin(time*1.1);
    const beaconBase=28+br*2;
    const beaconR=beaconBase+(isPlaying?audioBass*8:0);
    const beaconGlow=isPlaying?0.04+audioEnergy*0.08:0.015;

    // Massive soft outer bloom when playing
    if(isPlaying){
      ctx.beginPath();ctx.arc(cx,cy,beaconR*8,0,Math.PI*2);
      ctx.fillStyle=`rgba(212,182,138,${0.01+audioEnergy*0.02})`;ctx.fill();
      ctx.beginPath();ctx.arc(cx,cy,beaconR*5,0,Math.PI*2);
      ctx.fillStyle=`rgba(212,182,138,${0.02+audioEnergy*0.03})`;ctx.fill();
    }
    // Standard triple glow
    ctx.beginPath();ctx.arc(cx,cy,beaconR*3,0,Math.PI*2);
    ctx.fillStyle=`rgba(212,182,138,${beaconGlow})`;ctx.fill();
    ctx.beginPath();ctx.arc(cx,cy,beaconR*1.8,0,Math.PI*2);
    ctx.fillStyle=`rgba(212,182,138,${beaconGlow*2.5})`;ctx.fill();
    // Core
    ctx.shadowBlur=isPlaying?20+audioBass*25:15;
    ctx.shadowColor=`rgba(212,182,138,${isPlaying?0.4+audioEnergy*0.4:0.35})`;
    ctx.beginPath();ctx.arc(cx,cy,beaconR,0,Math.PI*2);
    ctx.fillStyle='#0c0c10';ctx.fill();
    const ringAlpha=isPlaying?0.4+audioBass*0.3:0.4+br*0.1;
    ctx.strokeStyle=`rgba(212,182,138,${ringAlpha})`;
    ctx.lineWidth=isPlaying?1.5+audioBass*2:1.2;ctx.stroke();
    ctx.shadowBlur=0;
    // Text — smaller, no hint
    ctx.fillStyle=`rgba(212,182,138,${isPlaying?0.7+audioEnergy*0.15:0.6+br*0.08})`;
    ctx.font='500 10px "JetBrains Mono"';ctx.textAlign='center';
    ctx.fillText('NEXUS',cx,cy+3);

    // ═══ FIREWORK PARTICLES — random bursts across the field ═══
    if(isPlaying&&Math.random()<audioEnergy*0.3){
      // Random position in the galaxy field
      const fAngle=Math.random()*Math.PI*2;
      const fDist=80+Math.random()*galaxyR*0.8;
      const fx=cx+Math.cos(fAngle)*fDist;
      const fy=cy+Math.sin(fAngle)*fDist;
      const burstCount=3+Math.floor(audioBass*8);
      for(let b=0;b<burstCount;b++)spawnNebula(fx,fy,audioEnergy*0.4);
    }

    // ═══ NODE DOTS ═══
    for(let i=0;i<P.length;i++){
      const a=P[i];if(a.x<vl||a.x>vr||a.y<vt||a.y>vb)continue;
      const isHit=state.searchHits.has(a.id)||state.activatedNodes.has(a.id);
      const isActive=state.activeNode&&state.activeNode.id===a.id;
      const isFrozen=state.frozenNode&&state.frozenNode.id===a.id;
      const isHover=state.hoverNode&&state.hoverNode.id===a.id;
      const dim=isA&&!isHit&&!isActive;
      const pulse=0.85+0.15*Math.sin(time*1.3+a.id*0.9);
      // Audio reactivity — dots pulse with music
      const musicPulse=isPlaying?1+audioEnergy*0.3:1;

      if(isActive||isFrozen){
        const r=DOT_ACTIVE*musicPulse;
        ctx.beginPath();ctx.arc(a.x,a.y,r*3,0,Math.PI*2);ctx.fillStyle='rgba(212,182,138,.06)';ctx.fill();
        ctx.beginPath();ctx.arc(a.x,a.y,r,0,Math.PI*2);ctx.fillStyle='rgba(255,250,240,.9)';ctx.fill();
        ctx.strokeStyle='rgba(212,182,138,.7)';ctx.lineWidth=2;ctx.stroke();
        ctx.font='500 11px "Libre Franklin"';ctx.textAlign='center';ctx.fillStyle='rgba(212,182,138,.9)';ctx.fillText(a.node.name,a.x,a.y-r-6);
      }else if(isHit){
        const r=DOT_HIT*pulse*musicPulse;
        ctx.beginPath();ctx.arc(a.x,a.y,r*2.5,0,Math.PI*2);ctx.fillStyle='rgba(212,182,138,.05)';ctx.fill();
        ctx.beginPath();ctx.arc(a.x,a.y,r,0,Math.PI*2);ctx.fillStyle='rgba(255,248,235,.8)';ctx.fill();
        ctx.strokeStyle='rgba(212,182,138,.5)';ctx.lineWidth=1.2;ctx.stroke();
        ctx.font='400 10px "Libre Franklin"';ctx.textAlign='center';ctx.fillStyle='rgba(212,182,138,.8)';ctx.fillText(a.node.name.slice(0,25),a.x,a.y-r-5);
      }else if(isHover){
        const r=DOT*1.8;
        ctx.beginPath();ctx.arc(a.x,a.y,r*2,0,Math.PI*2);ctx.fillStyle='rgba(212,182,138,.04)';ctx.fill();
        ctx.beginPath();ctx.arc(a.x,a.y,r,0,Math.PI*2);ctx.fillStyle='rgba(240,238,230,.7)';ctx.fill();
        ctx.strokeStyle='rgba(212,182,138,.3)';ctx.lineWidth=0.8;ctx.stroke();
        ctx.font='400 10px "Libre Franklin"';ctx.textAlign='center';ctx.fillStyle='rgba(212,182,138,.7)';ctx.fillText(a.node.name.slice(0,25),a.x,a.y-r-5);
      }else{
        const r=DOT*pulse*musicPulse;
        const alpha=dim?0.06:0.35;
        ctx.beginPath();ctx.arc(a.x,a.y,r,0,Math.PI*2);
        ctx.fillStyle=`rgba(220,215,205,${alpha*pulse})`;ctx.fill();
      }
    }

    ctx.restore();requestAnimationFrame(draw);
  }

  // ═══ INTERACTION ═══
  function setupCanvas(){
    const dpr=()=>Math.min(window.devicePixelRatio||1,1.5);

    canvas.addEventListener('click',e=>{
      if(state.dragging)return;
      const p=stw(e.clientX,e.clientY);
      const cx=W/2,cy=H/2;

      // Check if tapped the NEXUS beacon (secret)
      if(Math.hypot(p.x-cx,p.y-cy)<35){
        togglePlay(cx,cy);return;
      }

      let closest=null,closestD=25/state.transform.scale;
      state.particles.forEach(a=>{const d=Math.hypot(p.x-a.x,p.y-a.y);if(d<closestD){closest=a;closestD=d;}});
      if(closest){
        if(state.frozenNode&&state.frozenNode.id===closest.id){state.frozenNode=null;state.activeNode=null;closePanel();}
        else{state.frozenNode=closest;state.activeNode=closest.node;openPanel(closest.node);}
      }else{state.frozenNode=null;state.activeNode=null;closePanel();}
    });

    canvas.addEventListener('mousemove',e=>{if(state.dragging)return;const p=stw(e.clientX,e.clientY);state.hoverNode=null;state.particles.forEach(a=>{if(Math.hypot(p.x-a.x,p.y-a.y)<15/state.transform.scale)state.hoverNode=a;});const cx=W/2,cy=H/2;const overBeacon=Math.hypot(p.x-cx,p.y-cy)<35;canvas.style.cursor=(state.hoverNode||overBeacon)?'pointer':'default';});

    canvas.addEventListener('mousedown',e=>{if(e.button!==0)return;state.dragging=false;state.dragStart={x:e.clientX,y:e.clientY};state.dragTransStart={x:state.transform.x,y:state.transform.y};const onM=ev=>{const dx=ev.clientX-state.dragStart.x,dy=ev.clientY-state.dragStart.y;if(Math.abs(dx)+Math.abs(dy)>5)state.dragging=true;state.transform.x=state.dragTransStart.x+dx*dpr();state.transform.y=state.dragTransStart.y+dy*dpr();};const onU=()=>{document.removeEventListener('mousemove',onM);document.removeEventListener('mouseup',onU);setTimeout(()=>state.dragging=false,50);};document.addEventListener('mousemove',onM);document.addEventListener('mouseup',onU);});

    canvas.addEventListener('wheel',e=>{e.preventDefault();const f=e.deltaY>0?.92:1.08;const ns=Math.max(.1,Math.min(8,state.transform.scale*f));const r=canvas.getBoundingClientRect();const mx=(e.clientX-r.left)*dpr(),my=(e.clientY-r.top)*dpr();state.transform.x=mx-(mx-state.transform.x)*(ns/state.transform.scale);state.transform.y=my-(my-state.transform.y)*(ns/state.transform.scale);state.transform.scale=ns;},{passive:false});

    let ltd=0;
    canvas.addEventListener('touchstart',e=>{if(e.touches.length===1){state.dragStart={x:e.touches[0].clientX,y:e.touches[0].clientY};state.dragTransStart={x:state.transform.x,y:state.transform.y};}if(e.touches.length===2)ltd=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);},{passive:true});
    canvas.addEventListener('touchmove',e=>{const d=dpr();if(e.touches.length===1){state.transform.x=state.dragTransStart.x+(e.touches[0].clientX-state.dragStart.x)*d;state.transform.y=state.dragTransStart.y+(e.touches[0].clientY-state.dragStart.y)*d;}if(e.touches.length===2){const nd=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);state.transform.scale=Math.max(.1,Math.min(8,state.transform.scale*nd/ltd));ltd=nd;}},{passive:true});
  }

  function stw(sx,sy){const r=canvas.getBoundingClientRect(),d=Math.min(window.devicePixelRatio||1,1.5);return{x:((sx-r.left)*d-state.transform.x)/state.transform.scale,y:((sy-r.top)*d-state.transform.y)/state.transform.scale};}

  // ═══ NODE PANEL ═══
  function openPanel(n){
    state.activeNode=n;
    document.getElementById('npCat').textContent=n.category.toUpperCase();
    document.getElementById('npName').textContent=n.name;
    document.getElementById('npTags').textContent=(n.tags||[]).map(t=>'#'+t).join('  ');
    document.getElementById('npNotes').textContent=n.notes||'No notes.';
    // Sources
    const se=document.getElementById('npSources');se.innerHTML='';
    const src=n.sources||n.source_emails;
    if(src&&Array.isArray(src)&&src.length){
      const tt=NX.i18n?NX.i18n.t:k=>k;
      se.innerHTML='<div class="np-section-title">'+tt('sources')+' ('+src.length+')</div>';
      src.forEach(s=>{
        const card=document.createElement('div');card.className='np-email-card';
        card.innerHTML=`<div class="np-email-header"><div class="np-email-from">${s.from||'Unknown'}</div><div class="np-email-date">${s.date||''}</div></div><div class="np-email-subject">${s.subject||'(no subject)'}</div>`;
        if(s.snippet||s.body){const preview=document.createElement('div');preview.className='np-email-preview';preview.textContent=(s.snippet||s.body||'').slice(0,150);card.appendChild(preview);}
        if(s.body&&s.body.length>10){
          const toggle=document.createElement('button');toggle.className='np-email-toggle';toggle.textContent=tt('showEmail');
          const detail=document.createElement('div');detail.className='np-email-detail';detail.style.display='none';
          detail.innerHTML=`<div class="np-email-detail-header"><div class="np-detail-row"><span class="np-detail-label">From</span><span class="np-detail-value">${s.from||''}</span></div>${s.to?`<div class="np-detail-row"><span class="np-detail-label">To</span><span class="np-detail-value">${s.to}</span></div>`:''}<div class="np-detail-row"><span class="np-detail-label">Date</span><span class="np-detail-value">${s.date||''}</span></div><div class="np-detail-row"><span class="np-detail-label">Subject</span><span class="np-detail-value">${s.subject||''}</span></div></div><div class="np-email-full-body">${(s.body||'').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>`;
          toggle.addEventListener('click',()=>{const open=detail.style.display!=='none';detail.style.display=open?'none':'block';toggle.textContent=open?tt('showEmail'):tt('hideEmail');toggle.classList.toggle('open',!open);});
          card.appendChild(toggle);card.appendChild(detail);
        }
        se.appendChild(card);
      });
    }
    // Attachments
    const ae=document.getElementById('npAttachments');ae.innerHTML='';const att=n.attachments;
    if(att&&Array.isArray(att)&&att.length){
      ae.innerHTML='<div class="np-section-title">'+(NX.i18n?NX.i18n.t('attachments'):'ATTACHMENTS')+' ('+att.length+')</div>';
      att.forEach(a=>{const isImg=a.type&&(a.type.includes('image')||/\.(jpg|jpeg|png|gif|webp)$/i.test(a.filename||''));const card=document.createElement('div');card.className='np-att-card';
        if(isImg&&a.url){const img=document.createElement('img');img.className='np-att-preview';img.src=a.url;img.alt=a.filename||'';img.addEventListener('click',()=>window.open(a.url,'_blank'));card.appendChild(img);}
        const info=document.createElement('a');info.className='np-att-info';info.href=a.url||'#';info.target='_blank';info.innerHTML=`<span class="np-att-icon">${a.type&&a.type.includes('pdf')?'📄':isImg?'🖼':'📎'}</span><div class="np-att-details"><div class="np-att-name">${a.filename||'file'}</div><div class="np-att-meta">${a.from?'From: '+a.from:''} ${a.date||''}</div></div>`;
        card.appendChild(info);ae.appendChild(card);});
    }
    // Links
    const le=document.getElementById('npLinks');le.innerHTML='';
    if(n.links&&n.links.length){le.innerHTML='<div class="np-section-title">'+(NX.i18n?NX.i18n.t('connectedTo'):'CONNECTED TO')+' ('+n.links.length+')</div>';
      n.links.forEach(lid=>{const ln=NX.nodes.find(x=>x.id===lid);if(!ln)return;const d=document.createElement('div');d.className='np-link-item';d.innerHTML=`<span class="np-link-cat">${ln.category}</span>${ln.name}`;d.onclick=()=>{const fp=state.particles.find(p=>p.id===lid);if(fp){state.frozenNode=fp;state.activeNode=ln;openPanel(ln);}};le.appendChild(d);});}
    // Delete
    const delBtn=document.getElementById('npDelete');
    delBtn.textContent=NX.i18n?NX.i18n.t('deleteNode'):'Delete Node';
    delBtn.onclick=async()=>{if(!confirm('Delete "'+n.name+'"?'))return;delBtn.disabled=true;delBtn.textContent='...';
      try{const{error}=await NX.sb.from('nodes').delete().eq('id',n.id);if(!error){NX.nodes=NX.nodes.filter(x=>x.id!==n.id);state.particles=state.particles.filter(p=>p.id!==n.id);delete state.linkMap[n.id];closePanel();}else delBtn.textContent='Error';}catch(e){delBtn.textContent='Error';}
      setTimeout(()=>{delBtn.disabled=false;delBtn.textContent=NX.i18n?NX.i18n.t('deleteNode'):'Delete Node';},3000);};
    document.getElementById('nodePanel').classList.add('open');if(window.lucide)lucide.createIcons();
  }

  function closePanel(){state.activeNode=null;state.frozenNode=null;document.getElementById('nodePanel').classList.remove('open');}
  function checkEmpty(){const e=document.getElementById('canvasEmpty');if(e)e.style.display=NX.nodes.length<=1?'flex':'none';}
  function wakePhysics(){}

  function init(){resize();buildParticles();for(let i=0;i<150;i++)physics();setupCanvas();checkEmpty();
    if(NX.brain.initChat)NX.brain.initChat();if(NX.brain.initList)NX.brain.initList();if(NX.brain.initEvents)NX.brain.initEvents();draw();}

  NX.brain={init,closePanel,state,wakePhysics,show:()=>{resize();},openPanel};NX.modules.brain=NX.brain;NX.loaded.brain=true;
})();
