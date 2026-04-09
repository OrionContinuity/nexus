/* NEXUS Log v7 — with knowledge ingest */
(function(){
let data=[];
async function init(){
  await load();
  document.getElementById('logAdd').addEventListener('click',add);
  document.getElementById('logInput').addEventListener('keydown',e=>{if(e.key==='Enter')add();});
  document.getElementById('knowledgeBtn').addEventListener('click',addKnowledge);
  document.getElementById('knowledgeInput').addEventListener('keydown',e=>{if(e.key==='Enter')addKnowledge();});
}
async function load(){try{const r=await NX.sb.from('daily_logs').select('*').order('created_at',{ascending:false}).limit(50);data=r.data||[];}catch(e){}render();}
function render(){const list=document.getElementById('logList');list.innerHTML='';if(!data.length){list.innerHTML='<div class="log-empty">Nothing logged yet.<br>First one to report a clogged toilet gets bragging rights.</div>';return;}data.forEach(l=>{const d=document.createElement('div');d.className='log-entry';const isCR=(l.entry||'').startsWith('Cleaning Report');d.innerHTML=`<div class="log-text${isCR?' log-cleaning':''}">${isCR?'✓ ':''}${l.entry}</div><div class="log-meta">${new Date(l.created_at).toLocaleDateString()} · ${new Date(l.created_at).toLocaleTimeString()}</div>`;list.appendChild(d);});}
async function add(){const input=document.getElementById('logInput');if(!input.value.trim())return;await NX.sb.from('daily_logs').insert({entry:input.value.trim()});input.value='';load();}

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
        await NX.loadNodes();if(NX.brain)NX.brain.init();
      }else btn.textContent='No knowledge found';
    }else btn.textContent='No data';
  }catch(e){btn.textContent='Error';}
  setTimeout(()=>{btn.disabled=false;btn.textContent='+ Brain';},2500);
}
NX.modules.log={init,show:load};
})();
