/* ═══════════════════════════════════════════
   NEXUS — Log v5 (contrast fixes)
   ═══════════════════════════════════════════ */
(function(){
let data=[];

async function init(){
  await load();
  document.getElementById('logAdd').addEventListener('click',add);
  document.getElementById('logInput').addEventListener('keydown',e=>{if(e.key==='Enter')add();});
}

async function load(){
  try{const r=await NX.sb.from('daily_logs').select('*').order('created_at',{ascending:false}).limit(50);data=r.data||[];}catch(e){}
  render();
}

function render(){
  const list=document.getElementById('logList');list.innerHTML='';
  if(!data.length){list.innerHTML='<div class="log-empty">Nothing logged yet.<br>First one to report a clogged toilet gets bragging rights.</div>';return;}
  data.forEach(l=>{const d=document.createElement('div');d.className='log-entry';
    const isCR=(l.entry||'').startsWith('Cleaning Report');
    d.innerHTML=`<div class="log-text${isCR?' log-cleaning':''}">${isCR?'📋 ':''}${l.entry}</div><div class="log-meta">${new Date(l.created_at).toLocaleDateString()} · ${new Date(l.created_at).toLocaleTimeString()}</div>`;
    list.appendChild(d);});
}

async function add(){
  const input=document.getElementById('logInput');if(!input.value.trim())return;
  try{await NX.sb.from('daily_logs').insert({entry:input.value.trim()});}catch(e){}
  input.value='';load();
}

NX.modules.log={init,show:load};
})();
