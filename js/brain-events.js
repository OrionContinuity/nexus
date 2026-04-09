/* NEXUS Brain Events — Contractor scheduling */
(function(){
  function setupContractorEvents(){
    document.getElementById('eventsToggle').addEventListener('click',()=>{const p=document.getElementById('eventsPanel');p.classList.toggle('open');if(p.classList.contains('open'))loadEvents();});
    document.getElementById('eventsClose').addEventListener('click',()=>document.getElementById('eventsPanel').classList.remove('open'));
    document.getElementById('eventAddBtn').addEventListener('click',addEvent);
    document.getElementById('eventDate').value=NX.today;
    const dl=document.getElementById('contractorSuggest');dl.innerHTML='';
    NX.nodes.filter(n=>n.category==='contractors').forEach(n=>{const o=document.createElement('option');o.value=n.name;dl.appendChild(o);});
  }

  async function loadEvents(){
    const l=document.getElementById('eventsList');
    l.innerHTML='<div style="text-align:center;padding:16px;color:var(--faint);font-size:11px">Loading...</div>';
    try{const{data}=await NX.sb.from('contractor_events').select('*').gte('event_date',NX.today).order('event_date').order('event_time').limit(30);NX.brain.state.contractorEvents=data||[];}catch(e){NX.brain.state.contractorEvents=[];}
    renderEvents();
  }

  function renderEvents(){
    const events=NX.brain.state.contractorEvents,l=document.getElementById('eventsList');l.innerHTML='';
    if(!events.length){l.innerHTML='<div style="text-align:center;padding:24px;color:var(--muted);font-size:12px;line-height:2">No upcoming visits.</div>';return;}
    let ld='';events.forEach(ev=>{
      if(ev.event_date!==ld){ld=ev.event_date;const s=document.createElement('div');s.className='event-date-sep'+(ev.event_date===NX.today?' today':'');s.textContent=ev.event_date===NX.today?'TODAY':new Date(ev.event_date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});l.appendChild(s);}
      const el=document.createElement('div');el.className='event-card';
      el.innerHTML=`<div class="event-top"><span class="event-contractor">${ev.contractor_name||''}</span><span class="event-time">${ev.event_time?fmt(ev.event_time):''}</span></div><div class="event-desc">${ev.description||''}</div><div class="event-bottom"><span class="event-loc">${ev.location?ev.location[0].toUpperCase()+ev.location.slice(1):''}</span><button class="event-done-btn" data-id="${ev.id}">✓</button><button class="event-del-btn" data-id="${ev.id}">✕</button></div>`;
      el.querySelector('.event-done-btn').addEventListener('click',async e=>{e.stopPropagation();try{await NX.sb.from('contractor_events').update({status:'done'}).eq('id',e.target.dataset.id);}catch(err){}fireSynapse(ev.contractor_name);loadEvents();});
      el.querySelector('.event-del-btn').addEventListener('click',async e=>{e.stopPropagation();try{await NX.sb.from('contractor_events').delete().eq('id',e.target.dataset.id);}catch(err){}loadEvents();});
      el.addEventListener('click',()=>fireSynapse(ev.contractor_name));
      l.appendChild(el);
    });
  }

  function fmt(t){if(!t)return'';const[h,m]=t.split(':'),hr=+h;return((hr%12)||12)+':'+m+(hr>=12?' PM':' AM');}
  function fireSynapse(name){if(!name)return;NX.brain.wakePhysics();const cn=NX.nodes.find(n=>n.category==='contractors'&&name.toLowerCase().includes(n.name.toLowerCase().split(' ')[0]));if(cn){NX.brain.state.activatedNodes=new Set([cn.id,...(cn.links||[])]);setTimeout(()=>{NX.brain.state.activatedNodes=new Set();},8000);}}
  async function addEvent(){const c=document.getElementById('eventContractor').value.trim(),d=document.getElementById('eventDesc').value.trim(),dt=document.getElementById('eventDate').value,tm=document.getElementById('eventTime').value,loc=document.getElementById('eventLocation').value;if(!c||!dt)return;const b=document.getElementById('eventAddBtn');b.disabled=true;b.textContent='...';try{await NX.sb.from('contractor_events').insert({contractor_name:c,description:d,event_date:dt,event_time:tm||null,location:loc,status:'scheduled'});document.getElementById('eventContractor').value='';document.getElementById('eventDesc').value='';document.getElementById('eventTime').value='';loadEvents();fireSynapse(c);}catch(e){}b.disabled=false;b.textContent='+ Schedule';}

  NX.brain.initEvents=setupContractorEvents;
})();
