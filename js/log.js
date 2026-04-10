/* NEXUS Log v8 — with knowledge ingest + tickets */
(function(){
let data=[],tickets=[];
async function init(){
  await load();
  document.getElementById('logAdd').addEventListener('click',add);
  document.getElementById('logInput').addEventListener('keydown',e=>{if(e.key==='Enter')add();});
  document.getElementById('knowledgeBtn').addEventListener('click',addKnowledge);
  document.getElementById('knowledgeInput').addEventListener('keydown',e=>{if(e.key==='Enter')addKnowledge();});
}
async function load(){
  try{const r=await NX.sb.from('daily_logs').select('*').order('created_at',{ascending:false}).limit(50);data=r.data||[];}catch(e){}
  try{const r=await NX.sb.from('tickets').select('*').order('created_at',{ascending:false}).limit(20);tickets=r.data||[];}catch(e){}
  render();
}
function render(){
  const list=document.getElementById('logList');list.innerHTML='';

  // Open tickets section
  const openTickets=tickets.filter(t=>t.status==='open');
  if(openTickets.length){
    const sec=document.createElement('div');sec.className='ticket-section';
    sec.innerHTML=`<div class="ticket-section-title">🔧 OPEN TICKETS (${openTickets.length})</div>`;
    openTickets.forEach(t=>{
      const priColor=t.priority==='urgent'?'#ff5533':t.priority==='low'?'#39ff14':'#ffb020';
      const card=document.createElement('div');card.className='ticket-card';
      card.innerHTML=`<div class="ticket-card-header"><span class="ticket-card-pri" style="color:${priColor}">${(t.priority||'normal').toUpperCase()}</span><span class="ticket-card-who">${t.reported_by} · ${t.location}</span><span class="ticket-card-date">${new Date(t.created_at).toLocaleDateString()} ${new Date(t.created_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</span></div>
        <div class="ticket-card-notes">${t.notes||t.title}</div>
        ${t.photo_url?`<img src="${t.photo_url}" class="ticket-card-photo">`:''}
        ${t.ai_troubleshoot?`<details class="ticket-card-ai"><summary>AI Troubleshoot</summary><div class="ticket-card-ai-text">${t.ai_troubleshoot}</div></details>`:''}`;
      const actions=document.createElement('div');actions.className='ticket-card-actions';
      const closeBtn=document.createElement('button');closeBtn.className='ticket-close-btn';closeBtn.textContent='✓ Close Ticket';
      closeBtn.addEventListener('click',async()=>{
        await NX.sb.from('tickets').update({status:'closed'}).eq('id',t.id);
        closeBtn.textContent='Closed';card.style.opacity='0.4';
        if(NX.checkTicketBadge)NX.checkTicketBadge();
      });
      actions.appendChild(closeBtn);card.appendChild(actions);sec.appendChild(card);
    });
    list.appendChild(sec);
  }

  // Log entries
  if(!data.length&&!openTickets.length){list.innerHTML='<div class="log-empty"><div style="font-size:20px;margin-bottom:8px;opacity:.3">📋</div>Nothing logged yet.<br><span style="font-size:11px;color:var(--faint)">Log a repair, observation, or note above.<br>Cleaning reports auto-save here too.</span></div>';return;}
  data.forEach(l=>{
    const entry=l.entry||'';
    const isCR=entry.startsWith('Cleaning Report')||entry.startsWith('[AUTO');
    const isTK=entry.includes('TICKET');
    const d=document.createElement('div');d.className='log-entry'+(isCR?' log-entry-clean':'');
    const time=new Date(l.created_at);
    const timeStr=time.toLocaleDateString([],{month:'short',day:'numeric'})+' '+time.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});

    if(isCR){
      // Parse cleaning report for detailed view
      const lines=entry.split('\n');
      const header=lines[0]||'Cleaning Report';
      // Extract percentage
      const pctMatch=entry.match(/(\d+)%/);
      const pct=pctMatch?parseInt(pctMatch[1]):0;
      const pctColor=pct>=90?'#39ff14':pct>=70?'#ffb020':'#ff5533';
      
      // Parse sections
      let sections=[];
      let currentSec=null;
      lines.forEach(line=>{
        const secMatch=line.match(/^([A-ZÁ-Úa-záéíóú\s]+)\s*\((\d+)\/(\d+)\)/);
        if(secMatch){
          currentSec={name:secMatch[1].trim(),done:parseInt(secMatch[2]),total:parseInt(secMatch[3]),items:[],missed:[]};
          sections.push(currentSec);
        }
        if(currentSec&&line.startsWith('MISSED:')&&line.length>8){
          currentSec.missed=line.replace('MISSED:','').split(',').map(s=>s.trim()).filter(Boolean);
        }
      });

      d.innerHTML=`<div class="log-clean-head" onclick="this.parentElement.classList.toggle('expanded')">
        <span class="log-clean-pct" style="color:${pctColor}">${pct}%</span>
        <span class="log-clean-title">${header.replace('Cleaning Report — ','').replace('[AUTO 8AM] ','⏰ ')}</span>
        <span class="log-meta">${timeStr}</span>
        <span class="log-clean-arrow">▼</span>
      </div>
      <div class="log-clean-body">${sections.map(sec=>{
        const secPct=sec.total?Math.round(sec.done/sec.total*100):0;
        const secColor=secPct===100?'#39ff14':secPct>=70?'#ffb020':'#ff5533';
        return `<div class="log-clean-sec">
          <div class="log-clean-sec-head"><span style="color:${secColor}">${sec.done}/${sec.total}</span> ${sec.name}</div>
          ${sec.missed.length?sec.missed.map(m=>`<div class="log-missed-item">✗ ${m}</div>`).join(''):''}
        </div>`;
      }).join('')}
      <div class="log-clean-full" onclick="event.stopPropagation();this.nextElementSibling.style.display=this.nextElementSibling.style.display==='block'?'none':'block'">Show full report</div>
      <pre class="log-clean-raw" style="display:none">${entry}</pre>
      </div>`;
      // Delete button
      const del=document.createElement('button');del.className='log-del';del.textContent='✕';
      del.addEventListener('click',async(e)=>{
        e.stopPropagation();
        if(!confirm('Delete this log entry?'))return;
        await NX.sb.from('daily_logs').delete().eq('id',l.id);
        load();
      });
      d.appendChild(del);
    } else {
      d.innerHTML=`<div class="log-text${isTK?' log-ticket':''}">${isTK?'🔧 ':''}${entry}</div><div class="log-meta">${timeStr}</div>`;
      const del=document.createElement('button');del.className='log-del';del.textContent='✕';
      del.addEventListener('click',async(e)=>{
        e.stopPropagation();
        if(!confirm('Delete this log entry?'))return;
        await NX.sb.from('daily_logs').delete().eq('id',l.id);
        load();
      });
      d.appendChild(del);
    }
    list.appendChild(d);
  });
}
async function add(){const input=document.getElementById('logInput');if(!input.value.trim())return;await NX.sb.from('daily_logs').insert({entry:input.value.trim()});if(NX.toast)NX.toast('Logged ✓','success');input.value='';load();}

async function addKnowledge(){
  const inp=document.getElementById('knowledgeInput'),btn=document.getElementById('knowledgeBtn');
  const t=inp.value.trim();if(!t)return;btn.disabled=true;btn.textContent='Processing...';
  try{
    const answer=await NX.askClaude('Extract knowledge for restaurant ops (Suerte, Este, Bar Toti — Austin TX). Return ONLY raw JSON: {"nodes":[{"name":"...","category":"equipment|contractors|vendors|procedure|projects|people|systems|parts|location","tags":["..."],"notes":"..."}]}',[{role:'user',content:t}],1000);
    let json=answer.replace(/```json\s*/gi,'').replace(/```\s*/g,'');
    const s=json.indexOf('{'),e=json.lastIndexOf('}');
    if(s!==-1&&e>s){json=json.slice(s,e+1);
      const parsed=JSON.parse(json);
      if(parsed.nodes&&parsed.nodes.length){let created=0;
        const vc=['equipment','contractors','vendors','procedure','projects','people','systems','parts','location'];
        for(const n of parsed.nodes){const nm=(n.name||'').trim();if(!nm||nm.length<2)continue;
          const{error}=await NX.sb.from('nodes').insert({name:nm.slice(0,200),category:vc.includes(n.category)?n.category:'equipment',tags:Array.isArray(n.tags)?n.tags.filter(x=>typeof x==='string').slice(0,20):[],notes:(n.notes||'').slice(0,2000),links:[],access_count:1,source_emails:[]});
          if(!error)created++;}
        inp.value='';btn.textContent=`✓ ${created} node${created!==1?'s':''} added`;
        if(NX.toast)NX.toast(`${created} node${created!==1?'s':''} added to brain ✓`,'success');
        await NX.loadNodes();if(NX.brain)NX.brain.init();
      }else btn.textContent='No knowledge found';
    }else btn.textContent='No data';
  }catch(e){btn.textContent='Error';}
  setTimeout(()=>{btn.disabled=false;btn.textContent='+ Brain';},2500);
}
NX.modules.log={init,show:load};
})();
