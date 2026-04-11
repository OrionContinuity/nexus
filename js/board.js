/* NEXUS Board v7 — due dates, locations, overdue alerts */
(function(){
let cards=[];const COLS=['todo','in_progress','done'];const LABELS={todo:'To Do',in_progress:'In Progress',done:'Done'};
async function init(){await load();}
async function load(){try{const r=await NX.sb.from('kanban_cards').select('*').order('created_at',{ascending:true}).limit(200);cards=r.data||[];}catch(e){}render();}
function render(){const container=document.getElementById('boardContainer');container.innerHTML='';const today=new Date().toISOString().split('T')[0];
  if(!cards.length){container.innerHTML='<div class="board-empty">No cards yet.<br>Add one with the + button below,<br>or ingest data to auto-populate.</div>';return;}
  COLS.forEach(col=>{const cc=cards.filter(c=>c.column_name===col);const colEl=document.createElement('div');colEl.className='board-col';colEl.dataset.col=col;
    const overdueCount=col!=='done'?cc.filter(c=>c.due_date&&c.due_date<today).length:0;
    colEl.innerHTML=`<div class="board-col-header">${LABELS[col]}<span class="board-col-count">${cc.length}${overdueCount?' · <span style="color:#ff5533">'+overdueCount+' overdue</span>':''}</span></div>`;const body=document.createElement('div');body.className='board-col-body';
    colEl.addEventListener('dragover',e=>{e.preventDefault();colEl.classList.add('drag-over');});colEl.addEventListener('dragleave',()=>colEl.classList.remove('drag-over'));colEl.addEventListener('drop',async e=>{e.preventDefault();colEl.classList.remove('drag-over');const cid=e.dataTransfer.getData('text/plain');if(!cid)return;const card=cards.find(c=>String(c.id)===cid);if(card&&card.column_name!==col){card.column_name=col;render();try{await NX.sb.from('kanban_cards').update({column_name:col}).eq('id',card.id);}catch(e){}}});
    cc.forEach(card=>{const el=document.createElement('div');el.className='board-card';el.draggable=true;el.dataset.id=card.id;
      let dueMeta='';
      if(card.due_date){
        const ov=card.due_date<today&&col!=='done';
        const sn=!ov&&card.due_date<=new Date(Date.now()+3*86400000).toISOString().split('T')[0]&&col!=='done';
        dueMeta=`<span class="${ov?'due-overdue':sn?'due-soon':'due-ok'}">${card.due_date}</span>`;
      }
      el.innerHTML=`<div class="board-card-title">${card.title}</div><div class="board-card-meta">${card.location?'📍 '+card.location:''}${dueMeta?' · '+dueMeta:''}</div>`;
      // Tap to edit
      el.addEventListener('click',()=>editCard(card));
      el.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',String(card.id));el.classList.add('dragging');setTimeout(()=>el.style.display='none',0);});el.addEventListener('dragend',()=>{el.classList.remove('dragging');el.style.display='';});
      let tc=null;el.addEventListener('touchstart',e=>{const t=e.touches[0];tc=el.cloneNode(true);tc.style.cssText='position:fixed;z-index:1000;opacity:0.7;pointer-events:none;width:'+el.offsetWidth+'px';document.body.appendChild(tc);el._td={id:card.id};},{passive:true});el.addEventListener('touchmove',e=>{if(!tc)return;const t=e.touches[0];tc.style.left=t.clientX-50+'px';tc.style.top=t.clientY-20+'px';},{passive:true});el.addEventListener('touchend',async e=>{if(tc){tc.remove();tc=null;}if(!el._td)return;const t=e.changedTouches[0],de=document.elementFromPoint(t.clientX,t.clientY),ce=de?.closest('.board-col');if(ce){const tc2=ce.dataset.col,c2=cards.find(c=>String(c.id)===String(el._td.id));if(c2&&c2.column_name!==tc2){c2.column_name=tc2;render();try{await NX.sb.from('kanban_cards').update({column_name:tc2}).eq('id',c2.id);}catch(e){}}}el._td=null;});
      body.appendChild(el);});
    const addBtn=document.createElement('button');addBtn.className='board-add';addBtn.textContent='+ Add Card';
    addBtn.onclick=()=>addCard(col);
    body.appendChild(addBtn);colEl.appendChild(body);container.appendChild(colEl);});}

function addCard(col){
  const overlay=document.createElement('div');overlay.className='board-modal-overlay';
  overlay.innerHTML=`<div class="board-modal">
    <div class="board-modal-title">New Card</div>
    <input class="board-modal-input" id="bcTitle" placeholder="What needs to be done?">
    <div class="board-modal-row">
      <input type="date" class="board-modal-input board-modal-date" id="bcDue" placeholder="Due date">
      <input class="board-modal-input" id="bcLoc" placeholder="Location (optional)">
    </div>
    <div class="board-modal-actions">
      <button class="board-modal-cancel" id="bcCancel">Cancel</button>
      <button class="board-modal-save" id="bcSave">Add Card</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  document.getElementById('bcTitle')?.focus();
  document.getElementById('bcCancel')?.addEventListener('click',()=>overlay.remove());
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
  document.getElementById('bcSave')?.addEventListener('click',async()=>{
    const title=document.getElementById('bcTitle')?.value?.trim();
    if(!title)return;
    const due=document.getElementById('bcDue')?.value||null;
    const loc=document.getElementById('bcLoc')?.value?.trim()||null;
    overlay.remove();
    try{await NX.sb.from('kanban_cards').insert({title,column_name:col,due_date:due,location:loc});}catch(e){}
    load();
  });
}

function editCard(card){
  const overlay=document.createElement('div');overlay.className='board-modal-overlay';
  overlay.innerHTML=`<div class="board-modal">
    <div class="board-modal-title">Edit Card</div>
    <input class="board-modal-input" id="bcTitle" value="${(card.title||'').replace(/"/g,'&quot;')}">
    <div class="board-modal-row">
      <input type="date" class="board-modal-input board-modal-date" id="bcDue" value="${card.due_date||''}">
      <input class="board-modal-input" id="bcLoc" value="${card.location||''}" placeholder="Location">
    </div>
    <div class="board-modal-actions">
      <button class="board-modal-delete" id="bcDelete">Delete</button>
      <button class="board-modal-cancel" id="bcCancel">Cancel</button>
      <button class="board-modal-save" id="bcSave">Save</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
  document.getElementById('bcCancel')?.addEventListener('click',()=>overlay.remove());
  document.getElementById('bcDelete')?.addEventListener('click',async()=>{
    if(!confirm('Delete this card?'))return;
    overlay.remove();
    try{await NX.sb.from('kanban_cards').delete().eq('id',card.id);}catch(e){}
    load();
  });
  document.getElementById('bcSave')?.addEventListener('click',async()=>{
    const title=document.getElementById('bcTitle')?.value?.trim();
    if(!title)return;
    const due=document.getElementById('bcDue')?.value||null;
    const loc=document.getElementById('bcLoc')?.value?.trim()||null;
    overlay.remove();
    try{await NX.sb.from('kanban_cards').update({title,due_date:due,location:loc}).eq('id',card.id);}catch(e){}
    load();
  });
}

NX.modules.board={init,show:load};
})();
