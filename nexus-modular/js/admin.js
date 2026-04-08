/* ═══════════════════════════════════════════
   NEXUS — Admin/Ingest Module (admin.js)
   ═══════════════════════════════════════════ */
(function(){

async function init(){
  document.getElementById('ingestTextBtn').addEventListener('click',ingestText);
  document.getElementById('trelloBtn').addEventListener('click',trelloImport);
}

async function aiProcess(text,status){
  status.textContent='AI processing...';
  try{
    const answer=await NX.askClaude(
      'Extract knowledge from text. Return ONLY JSON: {"nodes":[{"name":"...","category":"equipment|contractors|vendors|procedure|projects","tags":["..."],"notes":"..."}],"cards":[{"title":"...","column_name":"todo"}]}',
      [{role:'user',content:text.slice(0,12000)}],
      2000
    );
    const m=answer.match(/\{[\s\S]*"nodes"[\s\S]*\}/);
    if(m)try{return JSON.parse(m[0]);}catch{}
    return null;
  }catch(e){status.textContent='Error: '+e.message;return null;}
}

async function saveExtracted(r,s){
  if(!r){s.textContent='No data extracted.';return;}
  let c=0;
  if(r.nodes)for(const n of r.nodes){
    try{await NX.sb.from('nodes').insert({name:n.name,category:n.category||'equipment',tags:n.tags||[],notes:n.notes||''});c++;}catch(e){}}
  if(r.cards)for(const x of r.cards){
    try{await NX.sb.from('kanban_cards').insert({title:x.title,column_name:x.column_name||'todo'});}catch(e){}}
  s.textContent=`Done. ${c} nodes created.`;
  // Reload nodes
  await NX.loadNodes();
  if(NX.brain)NX.brain.init();
}

async function ingestText(){
  const text=document.getElementById('ingestText').value.trim();if(!text)return;
  const btn=document.getElementById('ingestTextBtn'),status=document.getElementById('ingestStatus');
  btn.disabled=true;btn.textContent='...';
  const r=await aiProcess(text,status);await saveExtracted(r,status);
  btn.disabled=false;btn.textContent='⚡ Process';
  document.getElementById('ingestText').value='';
}

async function trelloImport(){
  const btn=document.getElementById('trelloBtn'),status=document.getElementById('ingestStatus');
  btn.disabled=true;btn.textContent='Pulling...';status.textContent='Fetching Trello...';
  try{
    const resp=await fetch(`https://api.trello.com/1/members/me/boards?key=${NX.TRELLO_KEY}&token=${NX.TRELLO_TOKEN}`);
    const boards=await resp.json();let all='TRELLO:\n';
    for(const board of boards){
      all+=`\n== ${board.name} ==\n`;
      const cr=await fetch(`https://api.trello.com/1/boards/${board.id}/cards?key=${NX.TRELLO_KEY}&token=${NX.TRELLO_TOKEN}`);
      const cards=await cr.json();
      cards.slice(0,30).forEach(c=>{
        all+=`- [${c.closed?'DONE':'OPEN'}] ${c.name}${c.desc?' | '+c.desc.slice(0,80):''}${c.due?' | Due:'+c.due.split('T')[0]:''}\n`;
      });
    }
    status.textContent='AI processing...';
    const r=await aiProcess(all,status);await saveExtracted(r,status);
  }catch(e){status.textContent='Error: '+e.message;}
  btn.disabled=false;btn.textContent='🔄 Smart Trello Import';
}

NX.modules.ingest={init,show:()=>{}};
})();
