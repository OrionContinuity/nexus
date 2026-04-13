/* NEXUS Brain Canvas v12 — Galaxy + Nebula + Audio
   Tap the NEXUS beacon to activate ambient audio + particle effects
*/
(function(){
  const canvas=document.getElementById('brainCanvas'),ctx=canvas.getContext('2d');
  let W,H,time=0,physicsFrame=0;

  const state={
    particles:[],transform:{x:0,y:0,scale:1},
    dragging:false,dragStart:{x:0,y:0},dragTransStart:{x:0,y:0},
    hoverNode:null,activeNode:null,frozenNode:null,dragStart:{x:0,y:0},
    activatedNodes:new Set(),searchHits:new Set(),
    linkMap:{},catMap:{},tagSets:{},
    contractorEvents:[],W:0,H:0,canvas,ctx
  };

  const DAMP=0.996,MAXV=0.28,DOT_BASE=3,DOT_HIT=6,DOT_ACTIVE=10;
  // Dynamic DOT — shrinks as node count grows so the galaxy stays readable
  function getDOT(){const n=(state.particles||[]).length;if(n<200)return DOT_BASE;if(n<500)return 2.5;if(n<1000)return 2;return 1.5;}
  // Dynamic galaxy radius — expands for large node counts
  function getGalaxyR(){const n=(state.particles||[]).length;const base=Math.min(W,H)*0.42;if(n<300)return base;if(n<800)return base*1.2;if(n<1500)return base*1.5;return base*1.7;}
  let drawRunning=false;

  // Theme detection
  function isDark(){return document.documentElement.getAttribute('data-theme')!=='light';}

  // Category color tints — adjusted per theme
  const CAT_DARK={
    equipment:[140,170,240],    // blue
    contractors:[100,200,170],  // teal
    vendors:[210,175,100],      // warm amber
    procedure:[180,140,210],    // soft purple
    projects:[200,180,80],      // gold
    people:[160,210,190],       // sage
    systems:[130,160,210],      // steel blue
    parts:[190,170,150],        // warm grey
    location:[140,190,140],     // muted green
  };
  const CAT_LIGHT={
    equipment:[50,90,180],
    contractors:[30,140,110],
    vendors:[160,120,40],
    procedure:[120,70,160],
    projects:[150,130,30],
    people:[60,140,120],
    systems:[60,100,170],
    parts:[130,110,90],
    location:[60,130,60],
  };
  const DEFAULT_DARK=[200,195,185];
  const DEFAULT_LIGHT=[100,95,85];
  function getCC(cat){return isDark()?(CAT_DARK[cat]||DEFAULT_DARK):(CAT_LIGHT[cat]||DEFAULT_LIGHT);}

  // ═══ NEBULA PARTICLES — beacon-001 inspired ═══
  const nebula=[];const MAX_NEBULA=300;
  const NEBULA_DARK=[
    [212,182,138],[220,195,155],[245,230,200],[180,160,130],
    [200,175,140],[230,210,170],[190,170,145],[255,240,210],
    [170,150,120],[240,220,180]
  ];
  const NEBULA_LIGHT=[
    [180,150,80],[160,130,60],[140,115,55],[170,140,70],
    [150,120,50],[190,160,90],[130,105,45],[200,170,100],
    [120,95,40],[175,145,75]
  ];
  function getNebColors(){return isDark()?NEBULA_DARK:NEBULA_LIGHT;}

  function spawnNebula(cx,cy,energy){
    if(nebula.length>=MAX_NEBULA)return;
    const angle=Math.random()*Math.PI*2;
    const speed=0.06+Math.random()*0.24+(energy||0)*0.6;
    const nc=getNebColors();
    const c=nc[Math.floor(Math.random()*nc.length)];
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
      if(p.fromCenter&&isPlaying){p.vx+=p.vx*0.0003*audioEnergy;p.vy+=p.vy*0.0003*audioEnergy;}
      else if(!isPlaying&&p.fromCenter){p.vx*=0.999;p.vy*=0.999;}
      p.x+=p.vx+wobble*(-p.vy/perpLen)*0.15;
      p.y+=p.vy+wobble*(p.vx/perpLen)*0.15;
    }
    // Particle-node interaction — nodes glow when particles pass near
    if(isPlaying){
      const P=state.particles;
      for(let i=0;i<P.length;i++){
        const a=P[i];
        if(a.glowAlpha>0)a.glowAlpha*=0.95; // Decay glow
        for(let j=0;j<nebula.length;j++){
          const np=nebula[j];
          const d=Math.abs(a.x-np.x)+Math.abs(a.y-np.y); // Manhattan for speed
          if(d<30){a.glowAlpha=Math.min(a.glowAlpha+0.15,0.8);break;}
        }
      }
    }else{
      // Decay all glows when not playing
      for(let i=0;i<state.particles.length;i++){
        if(state.particles[i].glowAlpha>0)state.particles[i].glowAlpha*=0.92;
      }
    }
  }

  function drawNebula(){
    for(let i=0;i<nebula.length;i++){
      const p=nebula[i];
      const pulse=0.7+0.3*Math.sin(time*p.pulseSpeed*60+p.pulsePhase);
      const fadeIn=Math.min(p.age/60,1);
      const fadeOut=Math.pow(p.life,0.6);
      const musicGlow=p.fromCenter&&isPlaying?(1+audioEnergy*1.5):1;
      const a=Math.min(p.baseAlpha*fadeIn*fadeOut*musicGlow*pulse,0.8);
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
    // Prevent any visual flash
    canvas.style.opacity='1';
    if(isPlaying){
      fadeOut(()=>{audioEl.pause();isPlaying=false;});
    }else{
      if(!audioCtx)initAudio();
      const resume=audioCtx.state==='suspended'?audioCtx.resume():Promise.resolve();
      resume.then(()=>{
        const p=audioEl.play();
        const start=()=>{isPlaying=true;fadeIn();for(let i=0;i<40;i++)spawnNebula(cx,cy,0.6);};
        if(p&&p.then)p.then(start).catch(e=>{setTimeout(()=>audioEl.play().then(start).catch(()=>{}),200);});
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
    const ARMS=4,galaxyR=getGalaxyR();
    // Scatter scales up with node count so particles spread more
    const scatterMult=nodes.length>800?35:nodes.length>400?25:18;
    const existingIds=new Set(state.particles.map(p=>p.id));
    const newParticles=[];
    nodes.forEach((n,idx)=>{
      if(existingIds.has(n.id))return; // Already in galaxy
      const arm=idx%ARMS,armBase=(arm/ARMS)*Math.PI*2;
      const t=(idx+1)/(nodes.length+1);
      const r=40+Math.pow(t,0.5)*galaxyR;
      const wind=armBase+Math.log(1+t*10)*1.8+(Math.random()-0.5)*0.4;
      const scatter=(Math.random()-0.5)*scatterMult*(0.3+t*0.7);
      const px=cx+Math.cos(wind)*r+Math.cos(wind+1.57)*scatter;
      const py=cy+Math.sin(wind)*r+Math.sin(wind+1.57)*scatter;
      const speed=1.2/Math.sqrt(Math.max(r/galaxyR,0.08)); // Slower orbits
      const p={id:n.id,x:px,y:py,vx:(py-cy)/(r||1)*speed*0.003,vy:-(px-cx)/(r||1)*speed*0.003,
        node:n,cat:n.category,tags:n.tags||[],links:n.links||[],access:n.access_count||1,
        glowAlpha:0,birthAge:0,isBorn:true};
      newParticles.push(p);
    });
    if(newParticles.length&&state.particles.length>0){
      // Add new ones with birth animation
      state.particles=state.particles.concat(newParticles);
    }else if(!state.particles.length){
      // First build — all at once
      state.particles=nodes.map((n,idx)=>{
        const arm=idx%ARMS,armBase=(arm/ARMS)*Math.PI*2;
        const t=(idx+1)/(nodes.length+1);
        const r=40+Math.pow(t,0.5)*galaxyR;
        const wind=armBase+Math.log(1+t*10)*1.8+(Math.random()-0.5)*0.4;
        const scatter=(Math.random()-0.5)*scatterMult*(0.3+t*0.7);
        const px=cx+Math.cos(wind)*r+Math.cos(wind+1.57)*scatter;
        const py=cy+Math.sin(wind)*r+Math.sin(wind+1.57)*scatter;
        const speed=1.2/Math.sqrt(Math.max(r/galaxyR,0.08));
        return{id:n.id,x:px,y:py,vx:(py-cy)/(r||1)*speed*0.003,vy:-(px-cx)/(r||1)*speed*0.003,
          node:n,cat:n.category,tags:n.tags||[],links:n.links||[],access:n.access_count||1,
          glowAlpha:0,birthAge:0,isBorn:false};
      });
    }
    state.linkMap={};state.catMap={};state.tagSets={};
    state.particles.forEach((p,i)=>{state.linkMap[p.id]=p;if(!state.catMap[p.cat])state.catMap[p.cat]=[];state.catMap[p.cat].push(i);state.tagSets[i]=new Set(p.tags);});
  }

  // ═══ PHYSICS ═══
  function physics(){
    const P=state.particles,len=P.length,cx=W/2,cy=H/2;
    const galaxyR=getGalaxyR();
    const DOT=getDOT();
    const doOverlap=len<500||physicsFrame%3===0; // Skip overlap check 2/3 frames at 500+
    let grid;
    if(doOverlap){const CELL=40;grid=new Map();for(let i=0;i<len;i++){const a=P[i];const key=((Math.floor(a.x/CELL)+500)<<16)|(Math.floor(a.y/CELL)+500);let c=grid.get(key);if(!c){c=[];grid.set(key,c);}c.push(i);}}
    for(let i=0;i<len;i++){const a=P[i];
      if(state.frozenNode&&state.frozenNode.id===a.id)continue;
      const dx=a.x-cx,dy=a.y-cy,dist=Math.sqrt(dx*dx+dy*dy)||1;
      const orbF=0.022/Math.sqrt(Math.max(dist/galaxyR,0.05));
      a.vx+=(dy/dist)*orbF;a.vy+=(-dx/dist)*orbF;
      if(dist<20){const s=12*(1-dist/20);a.vx+=dx/dist*s;a.vy+=dy/dist*s;}
      a.vx-=dx/dist*0.0006;a.vy-=dy/dist*0.0006;
      if(dist>galaxyR*1.3){const o=(dist-galaxyR*1.3)*0.003;a.vx-=dx/dist*o;a.vy-=dy/dist*o;}
      if(isPlaying&&audioEnergy>0.1){a.vx+=dx/dist*audioEnergy*0.02;a.vy+=dy/dist*audioEnergy*0.02;}
      // Overlap — only when doOverlap
      if(doOverlap&&grid){const CELL=40,gx=Math.floor(a.x/CELL)+500,gy=Math.floor(a.y/CELL)+500;
      for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++){const nb=grid.get(((gx+ox)<<16)|(gy+oy));if(!nb)continue;for(let ni=0;ni<nb.length;ni++){const j=nb[ni];if(j<=i)continue;const b=P[j];const ddx=a.x-b.x,ddy=a.y-b.y,dd=Math.sqrt(ddx*ddx+ddy*ddy)||1;if(dd<DOT*3){const push=(DOT*3-dd)*0.05;a.vx+=ddx/dd*push;a.vy+=ddy/dd*push;b.vx-=ddx/dd*push;b.vy-=ddy/dd*push;}}}}
      a.vx*=DAMP;a.vy*=DAMP;const sp=a.vx*a.vx+a.vy*a.vy;
      if(dist>25&&sp>MAXV*MAXV){const s=Math.sqrt(sp);a.vx=a.vx/s*MAXV;a.vy=a.vy/s*MAXV;}
      a.x+=a.vx;a.y+=a.vy;
    }
  }

  // ═══ RENDER ═══
  function draw(){
    // Always keep loop running — skip rendering when hidden
    const brainEl=document.getElementById('brainView');
    if(!brainEl||!brainEl.classList.contains('active')){
      requestAnimationFrame(draw);return;
    }
    // Recenter particles if canvas center shifted (tab switch, resize)
    const oldCx=W/2,oldCy=H/2;
    if(W<10||H<10){
      resize();
      if(W<10||H<10){
        const parent=canvas.parentElement;
        if(parent){
          const pr=parent.getBoundingClientRect();
          const dpr=Math.min(window.devicePixelRatio||1,1.5);
          if(pr.width>10&&pr.height>10){
            W=pr.width*dpr;H=pr.height*dpr;canvas.width=W;canvas.height=H;
            canvas.style.width=pr.width+'px';canvas.style.height=pr.height+'px';
            state.W=W;state.H=H;
          }
        }
      }
      requestAnimationFrame(draw);return;
    }
    // Check if center moved (happens after tab switch)
    if(oldCx>10&&oldCy>10){
      const newCx=W/2,newCy=H/2;
      const shiftX=newCx-oldCx,shiftY=newCy-oldCy;
      if(Math.abs(shiftX)>5||Math.abs(shiftY)>5){
        state.particles.forEach(p=>{p.x+=shiftX;p.y+=shiftY;});
      }
    }
    // Force resize check each frame when just became visible
    const rect=canvas.getBoundingClientRect();
    const dpr=Math.min(window.devicePixelRatio||1,1.5);
    const expectedW=rect.width*dpr,expectedH=rect.height*dpr;
    if(Math.abs(W-expectedW)>20||Math.abs(H-expectedH)>20){
      const prevCx=W/2,prevCy=H/2;
      resize();
      const dx=W/2-prevCx,dy=H/2-prevCy;
      if(Math.abs(dx)>5||Math.abs(dy)>5){
        state.particles.forEach(p=>{p.x+=dx;p.y+=dy;});
      }
    }
    time+=0.005;physicsFrame++;
    const P=state.particles,t=state.transform;
    if(P.length<800||physicsFrame%2===0)physics();
    updateAudio();

    // Spawn nebula particles — gentler, slower
    const cx=W/2,cy=H/2;
    const galaxyR=getGalaxyR();
    if(isPlaying){
      const spawnRate=1+Math.floor(audioEnergy*4);
      for(let i=0;i<spawnRate;i++)spawnNebula(cx,cy,audioEnergy);
    }else if(Math.random()<0.05){
      spawnNebula(cx,cy,0); // Very occasional idle particle
    }
    updateNebula();

    ctx.save();
    // Background — theme-aware radial gradient
    const bgGrad=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,Math.max(W,H)*0.7);
    if(isDark()){
      bgGrad.addColorStop(0,'#10101a');
      bgGrad.addColorStop(0.5,'#0c0c14');
      bgGrad.addColorStop(1,'#060608');
    }else{
      bgGrad.addColorStop(0,'#E4E0D6');
      bgGrad.addColorStop(0.5,'#DBD6CC');
      bgGrad.addColorStop(1,'#D0CABC');
    }
    ctx.fillStyle=bgGrad;ctx.fillRect(0,0,W,H);
    ctx.translate(t.x,t.y);ctx.scale(t.scale,t.scale);

    const isA=state.activatedNodes.size>0||state.searchHits.size>0;
    const invS=1/t.scale;
    const vl=-t.x*invS-50,vr=(-t.x+W)*invS+50;
    const vt=-t.y*invS-50,vb=(-t.y+H)*invS+50;

    // Nebula particles (behind everything)
    drawNebula(t);

    // Gold connection lines — curved for tapped node + search hits
    if(state.frozenNode||state.searchHits.size>0){
      const showNodes=new Set();
      if(state.frozenNode)showNodes.add(state.frozenNode.id);
      state.searchHits.forEach(id=>showNodes.add(id));

      for(let i=0;i<P.length;i++){
        const a=P[i];
        if(!showNodes.has(a.id))continue;
        const links=a.links||[];
        for(let li=0;li<links.length;li++){
          const b=state.linkMap[links[li]];if(!b)continue;
          const dist=Math.hypot(a.x-b.x,a.y-b.y);
          const alpha=Math.max(0.2,0.6-dist/2000);
          // Bezier curve — arc away from center
          const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
          const dx=b.y-a.y,dy=a.x-b.x;
          const curve=Math.min(dist*0.1,30);
          const cpx=mx+dx/dist*curve,cpy=my+dy/dist*curve;
          ctx.lineWidth=1.2;ctx.strokeStyle=`rgba(200,170,110,${alpha})`;
          ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.quadraticCurveTo(cpx,cpy,b.x,b.y);ctx.stroke();
          // Glow dot at endpoint
          ctx.beginPath();ctx.arc(b.x,b.y,3.5,0,Math.PI*2);
          ctx.fillStyle=`rgba(212,182,138,${Math.min(alpha*1.5,0.8)})`;ctx.fill();
          if(dist<500){
            ctx.font='500 10px "DM Sans"';ctx.textAlign='center';
            if(isDark()){
              ctx.fillStyle=`rgba(0,0,0,0.6)`;ctx.fillText((b.node?.name||'').slice(0,20),b.x+1,b.y-7);
              ctx.fillStyle=`rgba(212,182,138,${alpha})`;ctx.fillText((b.node?.name||'').slice(0,20),b.x,b.y-8);
            }else{
              ctx.fillStyle=`rgba(255,255,255,0.7)`;ctx.fillText((b.node?.name||'').slice(0,20),b.x+1,b.y-7);
              ctx.fillStyle=`rgba(80,60,20,${alpha})`;ctx.fillText((b.node?.name||'').slice(0,20),b.x,b.y-8);
            }
          }
        }
      }
    }

    // ═══ NEXUS BEACON — smaller, glowing, secret ═══
    const br=Math.sin(time*1.1);
    const beaconBase=28+br*2;
    const beaconR=beaconBase+(isPlaying?audioBass*8:0);
    const beaconGlow=isPlaying?0.08+audioEnergy*0.12:0.04;

    // Massive soft outer bloom when playing
    if(isPlaying){
      ctx.beginPath();ctx.arc(cx,cy,beaconR*8,0,Math.PI*2);
      ctx.fillStyle=`rgba(212,182,138,${0.02+audioEnergy*0.04})`;ctx.fill();
      ctx.beginPath();ctx.arc(cx,cy,beaconR*5,0,Math.PI*2);
      ctx.fillStyle=`rgba(212,182,138,${0.04+audioEnergy*0.06})`;ctx.fill();
    }
    // Standard triple glow
    ctx.beginPath();ctx.arc(cx,cy,beaconR*3,0,Math.PI*2);
    ctx.fillStyle=`rgba(212,182,138,${beaconGlow})`;ctx.fill();
    ctx.beginPath();ctx.arc(cx,cy,beaconR*1.8,0,Math.PI*2);
    ctx.fillStyle=`rgba(212,182,138,${beaconGlow*2.5})`;ctx.fill();
    // Core
    ctx.shadowBlur=isPlaying?25+audioBass*30:20;
    ctx.shadowColor=`rgba(212,182,138,${isPlaying?0.6+audioEnergy*0.4:0.5})`;
    ctx.beginPath();ctx.arc(cx,cy,beaconR,0,Math.PI*2);
    ctx.fillStyle=isDark()?'#10101a':'#F0EDE6';ctx.fill();
    const ringAlpha=isPlaying?0.6+audioBass*0.3:0.65+br*0.1;
    ctx.strokeStyle=isDark()?`rgba(212,182,138,${ringAlpha})`:`rgba(160,130,60,${ringAlpha})`;
    ctx.lineWidth=isPlaying?2+audioBass*2:1.8;ctx.stroke();
    ctx.shadowBlur=0;
    // Text
    ctx.fillStyle=isDark()?`rgba(212,182,138,${isPlaying?0.85+audioEnergy*0.15:0.8+br*0.08})`:`rgba(120,90,30,${isPlaying?0.85+audioEnergy*0.15:0.8+br*0.08})`;
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

    // ═══ NODE DOTS — category colored ═══
    const DOT=getDOT();
    for(let i=0;i<P.length;i++){
      const a=P[i];if(a.x<vl||a.x>vr||a.y<vt||a.y>vb)continue;
      const isHit=state.searchHits.has(a.id)||state.activatedNodes.has(a.id);
      const isActive=state.activeNode&&state.activeNode.id===a.id;
      const isFrozen=state.frozenNode&&state.frozenNode.id===a.id;
      const isHover=state.hoverNode&&state.hoverNode.id===a.id;
      const dim=(isA&&!isHit&&!isActive)||a.filtered;
      const pulse=0.85+0.15*Math.sin(time*1.3+a.id*0.9);
      const musicPulse=isPlaying?1+audioEnergy*0.3:1;
      const cc=getCC(a.cat);

      // Slow glow ramp-up when hit, slow fade when not
      if(!a.searchGlow)a.searchGlow=0;
      if(isHit||isActive){a.searchGlow=Math.min(a.searchGlow+0.02,1);}
      else{a.searchGlow=Math.max(a.searchGlow-0.008,0);}

      // Helper: draw label with shadow
      const drawLabel=(text,x,y,alpha,size)=>{
        const dk=isDark();
        ctx.font=`500 ${size||11}px "DM Sans","Outfit",sans-serif`;ctx.textAlign='center';
        if(dk){
          ctx.fillStyle=`rgba(0,0,0,${alpha*0.6})`;ctx.fillText(text,x+1,y+1);
          ctx.fillStyle=`rgba(212,182,138,${alpha})`;ctx.fillText(text,x,y);
        }else{
          ctx.fillStyle=`rgba(255,255,255,${alpha*0.7})`;ctx.fillText(text,x+1,y+1);
          ctx.fillStyle=`rgba(80,60,20,${alpha})`;ctx.fillText(text,x,y);
        }
      };

      if(isActive||isFrozen){
        const r=DOT_ACTIVE*musicPulse;
        ctx.beginPath();ctx.arc(a.x,a.y,r*3,0,Math.PI*2);ctx.fillStyle=`rgba(${cc[0]},${cc[1]},${cc[2]},.06)`;ctx.fill();
        ctx.beginPath();ctx.arc(a.x,a.y,r,0,Math.PI*2);ctx.fillStyle=`rgba(255,250,240,.9)`;ctx.fill();
        ctx.strokeStyle=`rgba(${cc[0]},${cc[1]},${cc[2]},.7)`;ctx.lineWidth=2;ctx.stroke();
        drawLabel(a.node.name,a.x,a.y-r-6,0.9);
      }else if(isHit||a.searchGlow>0.05){
        const g=a.searchGlow;
        const r=(DOT+g*(DOT_HIT-DOT))*pulse*musicPulse;
        ctx.beginPath();ctx.arc(a.x,a.y,r*2.5,0,Math.PI*2);ctx.fillStyle=`rgba(${cc[0]},${cc[1]},${cc[2]},${0.08*g})`;ctx.fill();
        ctx.beginPath();ctx.arc(a.x,a.y,r,0,Math.PI*2);ctx.fillStyle=`rgba(255,248,235,${0.5+g*0.5})`;ctx.fill();
        if(g>0.3){ctx.strokeStyle=`rgba(${cc[0]},${cc[1]},${cc[2]},${g*0.6})`;ctx.lineWidth=1.2*g;ctx.stroke();}
        if(g>0.4)drawLabel(a.node.name.slice(0,25),a.x,a.y-r-5,g*0.9);
      }else if(isHover){
        const r=DOT*1.8;
        ctx.beginPath();ctx.arc(a.x,a.y,r*2,0,Math.PI*2);ctx.fillStyle=`rgba(${cc[0]},${cc[1]},${cc[2]},.06)`;ctx.fill();
        ctx.beginPath();ctx.arc(a.x,a.y,r,0,Math.PI*2);ctx.fillStyle=`rgba(${cc[0]},${cc[1]},${cc[2]},.85)`;ctx.fill();
        ctx.strokeStyle=`rgba(212,182,138,.4)`;ctx.lineWidth=1;ctx.stroke();
        drawLabel(a.node.name.slice(0,25),a.x,a.y-r-5,0.85);
      }else{
        // Birth animation
        if(a.isBorn&&a.birthAge<180){
          a.birthAge++;
          const birthT=a.birthAge/180;
          const pop=birthT<0.1?birthT/0.1*3.5:birthT<0.2?3.5-(birthT-0.1)/0.1*2:birthT<0.35?1.5-(birthT-0.2)/0.15*0.5:1;
          const birthAlpha=Math.min(birthT*4,1);
          const flashAlpha=birthT<0.4?(1-birthT/0.4)*0.8:0;
          const ringExpand=birthT<0.5?birthT/0.5:1;
          const r=DOT*pop*musicPulse;
          if(flashAlpha>0.01){
            ctx.beginPath();ctx.arc(a.x,a.y,r*10*ringExpand,0,Math.PI*2);
            ctx.fillStyle=`rgba(${cc[0]},${cc[1]},${cc[2]},${flashAlpha*0.03})`;ctx.fill();
            ctx.beginPath();ctx.arc(a.x,a.y,r*6*ringExpand,0,Math.PI*2);
            ctx.fillStyle=`rgba(${cc[0]},${cc[1]},${cc[2]},${flashAlpha*0.06})`;ctx.fill();
            ctx.beginPath();ctx.arc(a.x,a.y,r*8*ringExpand,0,Math.PI*2);
            ctx.strokeStyle=`rgba(${cc[0]},${cc[1]},${cc[2]},${flashAlpha*0.15})`;ctx.lineWidth=1;ctx.stroke();
          }
          ctx.beginPath();ctx.arc(a.x,a.y,r,0,Math.PI*2);
          ctx.fillStyle=`rgba(${cc[0]},${cc[1]},${cc[2]},${birthAlpha*0.8})`;ctx.fill();
          if(birthT<0.6&&birthT>0.1)drawLabel(a.node.name.slice(0,20),a.x,a.y-r*3-8,(1-birthT/0.6)*0.7,10);
          if(a.birthAge===1){for(let b=0;b<12;b++)spawnNebula(a.x,a.y,0.5);}
          if(a.birthAge===30){for(let b=0;b<6;b++)spawnNebula(a.x,a.y,0.3);}
        }else{
          a.isBorn=false;
          const r=DOT*pulse*musicPulse;
          const alpha=dim?0.12:0.65;
          const glow=a.glowAlpha||0;
          if(glow>0.05){
            ctx.beginPath();ctx.arc(a.x,a.y,r*4,0,Math.PI*2);
            ctx.fillStyle=`rgba(${cc[0]},${cc[1]},${cc[2]},${glow*0.12})`;ctx.fill();
            ctx.beginPath();ctx.arc(a.x,a.y,r*2,0,Math.PI*2);
            ctx.fillStyle=`rgba(${cc[0]},${cc[1]},${cc[2]},${glow*0.3})`;ctx.fill();
            ctx.beginPath();ctx.arc(a.x,a.y,r*1.3,0,Math.PI*2);
            ctx.fillStyle=`rgba(${cc[0]},${cc[1]},${cc[2]},${alpha+glow*0.4})`;ctx.fill();
          }else{
            ctx.beginPath();ctx.arc(a.x,a.y,r,0,Math.PI*2);
            ctx.fillStyle=`rgba(${cc[0]},${cc[1]},${cc[2]},${alpha*pulse})`;ctx.fill();
          }
        }
      }
    }

    ctx.restore();
    requestAnimationFrame(draw);
  }

  // ═══ INTERACTION ═══
  function setupCanvas(){
    const dpr=()=>Math.min(window.devicePixelRatio||1,1.5);

    canvas.addEventListener('click',e=>{
      if(state.dragging)return;
      // Block node interaction when chat is open
      const hud=document.getElementById('chatHud');
      if(hud&&hud.classList.contains('expanded'))return;
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
    // Kill browser tap flash
    canvas.setAttribute('tabindex','-1');
    canvas.style.webkitTapHighlightColor='transparent';
    canvas.style.touchAction='none';
    canvas.addEventListener('touchstart',e=>{e.preventDefault();if(e.touches.length===1){state.dragStart={x:e.touches[0].clientX,y:e.touches[0].clientY};state.dragTransStart={x:state.transform.x,y:state.transform.y};}if(e.touches.length===2)ltd=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);},{passive:false});
    canvas.addEventListener('touchmove',e=>{e.preventDefault();const d=dpr();if(e.touches.length===1){const dx=e.touches[0].clientX-state.dragStart.x,dy=e.touches[0].clientY-state.dragStart.y;if(Math.abs(dx)+Math.abs(dy)>5)state.dragging=true;state.transform.x=state.dragTransStart.x+dx*d;state.transform.y=state.dragTransStart.y+dy*d;}if(e.touches.length===2){const nd=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);state.transform.scale=Math.max(.1,Math.min(8,state.transform.scale*nd/ltd));ltd=nd;}},{passive:false});
    canvas.addEventListener('touchend',e=>{
      if(state.dragging){state.dragging=false;return;}
      if(!state.dragStart)return;
      const hud=document.getElementById('chatHud');
      if(hud&&hud.classList.contains('expanded'))return;
      const sx=state.dragStart.x,sy=state.dragStart.y;
      const p=stw(sx,sy);const cx=W/2,cy=H/2;
      if(Math.hypot(p.x-cx,p.y-cy)<35){togglePlay(cx,cy);return;}
      let closest=null,closestD=25/state.transform.scale;
      state.particles.forEach(a=>{const d=Math.hypot(p.x-a.x,p.y-a.y);if(d<closestD){closest=a;closestD=d;}});
      if(closest){if(state.frozenNode&&state.frozenNode.id===closest.id){state.frozenNode=null;state.activeNode=null;closePanel();}else{state.frozenNode=closest;state.activeNode=closest.node;openPanel(closest.node);}}
      else{state.frozenNode=null;state.activeNode=null;closePanel();}
    },{passive:true});
  }

  function stw(sx,sy){const r=canvas.getBoundingClientRect(),d=Math.min(window.devicePixelRatio||1,1.5);return{x:((sx-r.left)*d-state.transform.x)/state.transform.scale,y:((sy-r.top)*d-state.transform.y)/state.transform.scale};}

  // ═══ NODE PANEL ═══
  function openPanel(n){
    const hud=document.getElementById('chatHud');
    if(hud)hud.classList.remove('expanded');
    state.activeNode=n;
    document.getElementById('npCat').textContent=n.category.toUpperCase();
    const ownerLabel=n.owner_id?` · ${findOwnerName(n.owner_id)}'s Brain`:'';
    document.getElementById('npName').textContent=n.name;
    document.getElementById('npTags').textContent='';
    const tagsEl=document.getElementById('npTags');
    (n.tags||[]).forEach(t=>{
      const tag=document.createElement('span');tag.className='np-tag-link';tag.textContent='#'+t;
      tag.addEventListener('click',()=>{if(NX.searchByTag)NX.searchByTag(t);closePanel();});
      tagsEl.appendChild(tag);
    });
    if(ownerLabel){const ow=document.createElement('span');ow.className='np-owner-label';ow.textContent=ownerLabel;tagsEl.appendChild(ow);}

    document.getElementById('npNotes').textContent=n.notes||'No notes.';

    // ═══ BACKLINKS — nodes that mention this node ═══
    const blEl=document.getElementById('npBacklinks');
    if(blEl){
      blEl.innerHTML='';
      const nameLow=n.name.toLowerCase();
      const backlinks=NX.nodes.filter(other=>other.id!==n.id&&!other.is_private&&(
        (other.notes||'').toLowerCase().includes(nameLow)||
        (other.tags||[]).some(t=>t.toLowerCase().includes(nameLow))||
        (other.links||[]).includes(n.id)
      ));
      if(backlinks.length){
        blEl.innerHTML='<div class="np-section-title">MENTIONED IN ('+backlinks.length+')</div>';
        backlinks.slice(0,10).forEach(bl=>{
          const d=document.createElement('div');d.className='np-link-item';
          d.innerHTML=`<span class="np-link-cat">${bl.category}</span>${bl.name}`;
          d.onclick=()=>{const fp=state.particles.find(p=>p.id===bl.id);if(fp){state.frozenNode=fp;state.activeNode=bl;openPanel(bl);}};
          blEl.appendChild(d);
        });
      }
    }

    // ═══ TRANSCLUSION — preview linked node content ═══
    const trEl=document.getElementById('npTransclusions');
    if(trEl){
      trEl.innerHTML='';
      const linkedNodes=(n.links||[]).map(lid=>NX.nodes.find(x=>x.id===lid)).filter(Boolean).slice(0,5);
      if(linkedNodes.length){
        trEl.innerHTML='<div class="np-section-title">RELATED DETAILS</div>';
        linkedNodes.forEach(ln=>{
          if(!ln.notes||ln.notes.length<10)return;
          const card=document.createElement('div');card.className='np-transclude';
          card.innerHTML=`<div class="np-transclude-head"><span class="np-link-cat">${ln.category}</span><span class="np-transclude-name">${ln.name}</span></div><div class="np-transclude-body">${(ln.notes||'').slice(0,200)}${ln.notes.length>200?'…':''}</div>`;
          card.addEventListener('click',()=>{const fp=state.particles.find(p=>p.id===ln.id);if(fp){state.frozenNode=fp;state.activeNode=ln;openPanel(ln);}});
          trEl.appendChild(card);
        });
      }
    }
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
        if(s.body&&s.body.length>10&&NX.isAdmin){
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
      // Deduplicate by filename
      const seen=new Set();const uniqueAtt=att.filter(a=>{const key=(a.filename||'')+(a.url||'');if(seen.has(key))return false;seen.add(key);return true;});
      ae.innerHTML='<div class="np-section-title">'+(NX.i18n?NX.i18n.t('attachments'):'ATTACHMENTS')+' ('+uniqueAtt.length+')</div>';
      uniqueAtt.forEach(a=>{
        const fname=a.filename||'file';
        const ext=(fname.split('.').pop()||'').toLowerCase();
        const isImg=['jpg','jpeg','png','gif','webp'].includes(ext);
        const isPdf=ext==='pdf';
        const icon=isPdf?'📄':isImg?'🖼':ext==='xlsx'||ext==='csv'?'📊':ext==='docx'?'📝':'📎';
        
        const card=document.createElement('div');card.className='np-att-card';
        card.innerHTML=`<div class="np-att-info"><span class="np-att-icon">${icon}</span><div class="np-att-details"><div class="np-att-name">${fname.length>35?fname.slice(0,32)+'...':fname}</div><div class="np-att-meta">${a.from?a.from.split('<')[0].trim():''} ${a.date?'· '+a.date.split('T')[0]:''}</div></div></div>`;
        
        // View button — opens in new tab
        if(a.url){
          const viewBtn=document.createElement('button');viewBtn.className='np-att-view';viewBtn.textContent='View';
          viewBtn.addEventListener('click',async()=>{
            viewBtn.textContent='...';
            try{
              // Try signed URL for private bucket
              const path=a.url.split('/nexus-files/').pop();
              if(path){
                const{data:signedData,error}=await NX.sb.storage.from('nexus-files').createSignedUrl(path,3600);
                if(!error&&signedData?.signedUrl){window.open(signedData.signedUrl,'_blank');viewBtn.textContent='View';return;}
              }
              // Fallback to direct URL
              window.open(a.url,'_blank');
            }catch(e){window.open(a.url,'_blank');}
            viewBtn.textContent='View';
          });
          card.appendChild(viewBtn);
        }

        // Image preview — only if image and URL exists
        if(isImg&&a.url){
          const preview=document.createElement('div');preview.className='np-att-img-wrap';
          const img=document.createElement('img');img.className='np-att-preview';
          img.alt=fname;
          img.loading='lazy';
          // Use signed URL for preview
          (async()=>{
            try{
              const path=a.url.split('/nexus-files/').pop();
              if(path){const{data}=await NX.sb.storage.from('nexus-files').createSignedUrl(path,3600);if(data?.signedUrl)img.src=data.signedUrl;else img.src=a.url;}
              else img.src=a.url;
            }catch(e){img.src=a.url;}
          })();
          img.onerror=()=>{preview.remove();}; // Hide if broken
          img.addEventListener('click',()=>window.open(img.src,'_blank'));
          preview.appendChild(img);card.appendChild(preview);
        }
        ae.appendChild(card);
      });
    }
    // Links
    const le=document.getElementById('npLinks');le.innerHTML='';
    if(n.links&&n.links.length){le.innerHTML='<div class="np-section-title">'+(NX.i18n?NX.i18n.t('connectedTo'):'CONNECTED TO')+' ('+n.links.length+')</div>';
      n.links.forEach(lid=>{const ln=NX.nodes.find(x=>x.id===lid);if(!ln)return;const d=document.createElement('div');d.className='np-link-item';d.innerHTML=`<span class="np-link-cat">${ln.category}</span>${ln.name}`;d.onclick=()=>{const fp=state.particles.find(p=>p.id===lid);if(fp){state.frozenNode=fp;state.activeNode=ln;openPanel(ln);}};le.appendChild(d);});}
    // Admin-only controls
    document.getElementById('npEditNotes').style.display=NX.isAdmin?'':'none';
    document.querySelector('.np-add-section').style.display=NX.isAdmin?'':'none';
    document.querySelector('.np-footer').style.display=NX.isAdmin?'':'none';

    // Delete — small ✕ button (admin only)
    const delBtn=document.getElementById('npDelete');
    delBtn.onclick=async()=>{if(!confirm('Delete "'+n.name+'"?'))return;
      try{const{error}=await NX.sb.from('nodes').delete().eq('id',n.id);if(!error){NX.nodes=NX.nodes.filter(x=>x.id!==n.id);state.particles=state.particles.filter(p=>p.id!==n.id);delete state.linkMap[n.id];closePanel();}}catch(e){}};

    // Edit notes
    const editBtn=document.getElementById('npEditNotes');
    editBtn.onclick=()=>{
      const current=n.notes||'';
      const ta=document.createElement('textarea');ta.className='np-edit-textarea';ta.value=current;ta.rows=6;
      const saveBtn=document.createElement('button');saveBtn.className='np-edit-btn';saveBtn.textContent='Save';saveBtn.style.marginTop='6px';
      const cancelBtn=document.createElement('button');cancelBtn.className='np-edit-btn';cancelBtn.textContent='Cancel';cancelBtn.style.marginTop='6px';cancelBtn.style.marginLeft='6px';
      const notesEl=document.getElementById('npNotes');notesEl.innerHTML='';
      // Show version history if exists
      const history=n.notes_history||[];
      if(history.length){
        const histBtn=document.createElement('button');histBtn.className='np-edit-btn np-hist-btn';histBtn.textContent=`↺ ${history.length} versions`;histBtn.style.marginTop='6px';histBtn.style.marginLeft='6px';
        histBtn.onclick=()=>{
          const histDiv=document.createElement('div');histDiv.className='np-history';
          history.slice().reverse().forEach((h,i)=>{
            const item=document.createElement('div');item.className='np-hist-item';
            item.innerHTML=`<div class="np-hist-date">${h.date||'unknown'}</div><div class="np-hist-text">${(h.text||'').slice(0,100)}</div>`;
            item.onclick=()=>{ta.value=h.text;histDiv.remove();};
            histDiv.appendChild(item);
          });
          notesEl.appendChild(histDiv);
        };
        notesEl.appendChild(ta);notesEl.appendChild(saveBtn);notesEl.appendChild(cancelBtn);notesEl.appendChild(histBtn);
      }else{
        notesEl.appendChild(ta);notesEl.appendChild(saveBtn);notesEl.appendChild(cancelBtn);
      }
      ta.focus();
      saveBtn.onclick=async()=>{const newNotes=ta.value;
        // Save version history
        const hist=n.notes_history||[];
        if(current&&current.length>5)hist.push({text:current,date:new Date().toISOString().split('T')[0]});
        const trimmedHist=hist.slice(-10); // Keep last 10 versions
        await NX.sb.from('nodes').update({notes:newNotes,notes_history:trimmedHist}).eq('id',n.id);
        n.notes=newNotes;n.notes_history=trimmedHist;
        notesEl.textContent=newNotes||'No notes.';};
      cancelBtn.onclick=()=>{notesEl.textContent=current||'No notes.';};
    };

    // File upload
    const fileInput=document.getElementById('npFileInput');
    const uploadStatus=document.getElementById('npUploadStatus');
    fileInput.onchange=async()=>{
      const files=fileInput.files;if(!files.length)return;
      uploadStatus.textContent='Uploading...';
      const atts=n.attachments||[];
      for(const file of files){
        try{
          const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
          const path=`node-files/${n.id}_${Date.now()}_${safeName}`;
          const{error:upErr}=await NX.sb.storage.from('nexus-files').upload(path,file,{contentType:file.type,upsert:true});
          if(upErr){uploadStatus.textContent='Failed: '+upErr.message;continue;}
          const{data:urlData}=NX.sb.storage.from('nexus-files').getPublicUrl(path);
          const url=urlData?.publicUrl||'';
          atts.push({url,filename:file.name,type:file.type,date:new Date().toISOString().split('T')[0],from:'Manual upload'});
          uploadStatus.textContent=`✓ ${file.name}`;
        }catch(e){uploadStatus.textContent='Error: '+e.message;}
      }
      await NX.sb.from('nodes').update({attachments:atts}).eq('id',n.id);
      n.attachments=atts;openPanel(n);fileInput.value='';
      setTimeout(()=>{uploadStatus.textContent='';},3000);
    };

    document.getElementById('nodePanel').classList.add('open');if(window.lucide)lucide.createIcons();
  }

  function closePanel(){state.activeNode=null;state.frozenNode=null;const np=document.getElementById('nodePanel');if(np)np.classList.remove('open');}

  // Close panel when leaving brain view
  function hideOnLeave(){closePanel();const hud=document.getElementById('chatHud');if(hud)hud.classList.remove('expanded');}
  function findOwnerName(ownerId){
    if(!ownerId)return'Shared';
    if(NX.currentUser&&NX.currentUser.id===ownerId)return NX.currentUser.name;
    // Check allNodes for user reference or return ID
    return'User #'+ownerId;
  }
  function checkEmpty(){const e=document.getElementById('canvasEmpty');if(e)e.style.display=NX.nodes.length<1?'flex':'none';}
  function wakePhysics(){}

  function buildFilters(){
    const el=document.getElementById('brainFilters');if(!el)return;
    const cats=new Set();state.particles.forEach(p=>{if(p.cat)cats.add(p.cat);});
    el.innerHTML='';
    const allBtn=document.createElement('button');allBtn.className='brain-filter-btn active';allBtn.textContent='All';
    allBtn.addEventListener('click',()=>{
      el.querySelectorAll('.brain-filter-btn').forEach(b=>b.classList.remove('active'));
      allBtn.classList.add('active');
      state.particles.forEach(p=>{p.filtered=false;});
    });
    el.appendChild(allBtn);
    Array.from(cats).sort().forEach(cat=>{
      const btn=document.createElement('button');btn.className='brain-filter-btn';
      btn.textContent=cat.charAt(0).toUpperCase()+cat.slice(1);
      btn.addEventListener('click',()=>{
        el.querySelectorAll('.brain-filter-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        state.particles.forEach(p=>{p.filtered=p.cat!==cat;});
      });
      el.appendChild(btn);
    });
  }

  function init(){
    resize();
    if(W<10||H<10){
      setTimeout(()=>{resize();buildParticles();for(let i=0;i<150;i++)physics();setupCanvas();checkEmpty();buildFilters();draw();},300);
      return;
    }
    buildParticles();for(let i=0;i<150;i++)physics();setupCanvas();checkEmpty();buildFilters();
    if(NX.brain.initChat)NX.brain.initChat();if(NX.brain.initList)NX.brain.initList();if(NX.brain.initEvents)NX.brain.initEvents();
    draw(); // Starts loop — runs forever
  }

  NX.brain={init,closePanel,state,wakePhysics,show:()=>{
    // Delay resize to let browser lay out the view first
    requestAnimationFrame(()=>{resize();requestAnimationFrame(()=>{if(W<10||H<10)resize();});});
  },openPanel};NX.modules.brain=NX.brain;NX.loaded.brain=true;
})();
