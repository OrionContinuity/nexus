/* NEXUS Board v8 — unified cards table (replaces kanban_cards + tickets) *
(function(){
let cards=[];
const TABLE='cards';
// Fallback: if cards table doesn't exist yet, use kanban_cards
let useLegacy=false;
const COLS=['todo','doing','done'];
const LABELS={todo:'To Do',doing:'In Progress',done:'Done'};
const PRI_COLORS={urgent:'#ff5533',normal:'#ffb020',low:'#39ff14'};

async function init(){await load();}

async function load(){
  try{
    const r=await NX.sb.from(TABLE).select('*').neq('status','closed').order('created_at',{ascending:true}).limit(200);
    if(r.error&&r.error.message?.includes('does not exist')){
      // Fallback to legacy tables
      useLegacy=true;
      const r2=await NX.sb.from('kanban_cards').select('*').order('created_at',{ascending:true}).limit(200);
      cards=(r2.data||[]).map(c=>({...c,status:c.column_name||'todo',priority:'normal',source:'legacy'}));
      // Also pull open tickets into the board
      try{
        const r3=await NX.sb.from('tickets').select('*').eq('status','open').order('created_at',{ascending:false}).limit(50);
        if(r3.data)cards=cards.concat(r3.data.map(t=>({...t,status:'todo',source:'ticket'})));
      }catch(e){}
    }else{
      cards=r.data||[];
    }
  }catch(e){cards=[];}
  render();
}

function tbl(){return useLegacy?'kanban_cards':TABLE;}

function render(){
  const container=document.getElementById('boardContainer');container.innerHTML='';
  const today=new Date().toISOString().split('T')[0];
  if(!cards.length){container.innerHTML='<div class="board-empty">No cards yet.<br>Add one with the + button below,<br>or say "add card: ..." in chat.</div>';return;}

  COLS.forEach(col=>{
    // Map legacy column_name to status
    const cc=cards.filter(c=>{
      const st=c.status||c.column_name||'todo';
      if(col==='doing')return st==='doing'||st==='in_progress';
      return st===col;
    });
    const colEl=document.createElement('div');colEl.className='board-col';colEl.dataset.col=col;
    const overdueCount=col!=='done'?cc.filter(c=>c.due_date&&c.due_date<today).length:0;
    colEl.innerHTML=`<div class="board-col-header">${LABELS[col]}<span class="board-col-count">${cc.length}${overdueCount?' · <span style="color:#ff5533">'+overdueCount+' overdue</span>':''}</span></div>`;
    const body=document.createElement('div');body.className='board-col-body';

    // Drag & drop
    colEl.addEventListener('dragover',e=>{e.preventDefault();colEl.classList.add('drag-over');});
    colEl.addEventListener('dragleave',()=>colEl.classList.remove('drag-over'));
    colEl.addEventListener('drop',async e=>{
      e.preventDefault();colEl.classList.remove('drag-over');
      const cid=e.dataTransfer.getData('text/plain');if(!cid)return;
      const card=cards.find(c=>String(c.id)===cid);
      if(card){await moveCard(card,col);}
    });

    cc.forEach(card=>{
      const el=document.createElement('div');el.className='board-card';el.draggable=true;el.dataset.id=card.id;
      const pri=card.priority||'normal';
      const priDot=pri!=='normal'?`<span class="board-pri-dot" style="background:${PRI_COLORS[pri]||PRI_COLORS.normal}" title="${pri}"></span>`:'';
      let dueMeta='';
      if(card.due_date){
        const ov=card.due_date<today&&col!=='done';
        const sn=!ov&&card.due_date<=new Date(Date.now()+3*86400000).toISOString().split('T')[0]&&col!=='done';
        dueMeta=`<span class="${ov?'due-overdue':sn?'due-soon':'due-ok'}">${card.due_date}</span>`;
      }
      const assignee=card.assignee?`<span class="board-assignee">👤 ${card.assignee}</span>`:'';
      el.innerHTML=`<div class="board-card-top">${priDot}<div class="board-card-title">${card.title}</div></div>
        <div class="board-card-meta">${card.location?'📍 '+card.location:''}${dueMeta?' · '+dueMeta:''} ${assignee}</div>`;

      el.addEventListener('click',()=>editCard(card));
      el.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',String(card.id));el.classList.add('dragging');setTimeout(()=>el.style.display='none',0);});
      el.addEventListener('dragend',()=>{el.classList.remove('dragging');el.style.display='';});

      // Touch drag
      let tc=null;
      el.addEventListener('touchstart',e=>{const t=e.touches[0];tc=el.cloneNode(true);tc.style.cssText='position:fixed;z-index:1000;opacity:0.7;pointer-events:none;width:'+el.offsetWidth+'px';document.body.appendChild(tc);el._td={id:card.id};},{passive:true});
      el.addEventListener('touchmove',e=>{if(!tc)return;const t=e.touches[0];tc.style.left=t.clientX-50+'px';tc.style.top=t.clientY-20+'px';},{passive:true});
      el.addEventListener('touchend',async e=>{
        if(tc){tc.remove();tc=null;}if(!el._td)return;
        const t=e.changedTouches[0],de=document.elementFromPoint(t.clientX,t.clientY),ce=de?.closest('.board-col');
        if(ce){const nc=ce.dataset.col;const c2=cards.find(c=>String(c.id)===String(el._td.id));
          if(c2)await moveCard(c2,nc);
        }el._td=null;
      });
      body.appendChild(el);
    });

    const addBtn=document.createElement('button');addBtn.className='board-add';addBtn.textContent='+ Add Card';
    addBtn.onclick=()=>addCard(col);
    body.appendChild(addBtn);colEl.appendChild(body);container.appendChild(colEl);
  });
}

async function moveCard(card,newStatus){
  const oldStatus=card.status||card.column_name;
  if(oldStatus===newStatus||(newStatus==='doing'&&oldStatus==='in_progress'))return;
  if(useLegacy){
    const legacyCol=newStatus==='doing'?'in_progress':newStatus;
    card.column_name=legacyCol;card.status=newStatus;
    render();
    if(card.source==='ticket'){
      if(newStatus==='done')await NX.sb.from('tickets').update({status:'closed'}).eq('id',card.id);
    }else{
      await NX.sb.from('kanban_cards').update({column_name:legacyCol}).eq('id',card.id);
    }
  }else{
    card.status=newStatus;render();
    await NX.sb.from(TABLE).update({status:newStatus,updated_at:new Date().toISOString()}).eq('id',card.id);
  }
  NX.syslog&&NX.syslog('card_moved',`${card.title} → ${newStatus}`);
}

function addCard(col){
  const overlay=document.createElement('div');overlay.className='board-modal-overlay';
  overlay.innerHTML=`<div class="board-modal">
    <div class="board-modal-title">New Card</div>
    <input class="board-modal-input" id="bcTitle" placeholder="What needs to be done?">
    <div class="board-modal-row">
      <input type="date" class="board-modal-input board-modal-date" id="bcDue">
      <select class="board-modal-input board-modal-pri" id="bcPri"><option value="normal">Normal</option><option value="urgent">Urgent</option><option value="low">Low</option></select>
    </div>
    <div class="board-modal-row">
      <input class="board-modal-input" id="bcLoc" placeholder="Location">
      <input class="board-modal-input" id="bcAssign" placeholder="Assignee">
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
    const title=document.getElementById('bcTitle')?.value?.trim();if(!title)return;
    const due=document.getElementById('bcDue')?.value||null;
    const loc=document.getElementById('bcLoc')?.value?.trim()||null;
    const pri=document.getElementById('bcPri')?.value||'normal';
    const assignee=document.getElementById('bcAssign')?.value?.trim()||null;
    overlay.remove();
    if(useLegacy){
      await NX.sb.from('kanban_cards').insert({title,column_name:col==='doing'?'in_progress':col,due_date:due,location:loc});
    }else{
      await NX.sb.from(TABLE).insert({title,status:col,due_date:due,location:loc,priority:pri,assignee,source:'manual',reported_by:NX.currentUser?.name||''});
    }
    NX.syslog&&NX.syslog('card_created',title);
    load();
  });
}

function editCard(card){
  const overlay=document.createElement('div');overlay.className='board-modal-overlay';
  overlay.innerHTML=`<div class="board-modal">
    <div class="board-modal-title">Edit Card</div>
    <input class="board-modal-input" id="bcTitle" value="${(card.title||'').replace(/"/g,'&quot;')}">
    <textarea class="board-modal-input" id="bcNotes" placeholder="Notes..." rows="3">${(card.notes||'').replace(/</g,'&lt;')}</textarea>
    <div class="board-modal-row">
      <input type="date" class="board-modal-input board-modal-date" id="bcDue" value="${card.due_date||''}">
      <select class="board-modal-input board-modal-pri" id="bcPri">
        <option value="normal"${card.priority==='normal'?' selected':''}>Normal</option>
        <option value="urgent"${card.priority==='urgent'?' selected':''}>Urgent</option>
        <option value="low"${card.priority==='low'?' selected':''}>Low</option>
      </select>
    </div>
    <div class="board-modal-row">
      <input class="board-modal-input" id="bcLoc" value="${card.location||''}" placeholder="Location">
      <input class="board-modal-input" id="bcAssign" value="${card.assignee||''}" placeholder="Assignee">
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
    if(!confirm('Delete this card?'))return;overlay.remove();
    if(useLegacy){
      if(card.source==='ticket')await NX.sb.from('tickets').delete().eq('id',card.id);
      else await NX.sb.from('kanban_cards').delete().eq('id',card.id);
    }else await NX.sb.from(TABLE).delete().eq('id',card.id);
    NX.syslog&&NX.syslog('card_deleted',card.title);
    load();
  });
  document.getElementById('bcSave')?.addEventListener('click',async()=>{
    const title=document.getElementById('bcTitle')?.value?.trim();if(!title)return;
    const notes=document.getElementById('bcNotes')?.value?.trim()||null;
    const due=document.getElementById('bcDue')?.value||null;
    const loc=document.getElementById('bcLoc')?.value?.trim()||null;
    const pri=document.getElementById('bcPri')?.value||'normal';
    const assignee=document.getElementById('bcAssign')?.value?.trim()||null;
    overlay.remove();
    if(useLegacy){
      if(card.source==='ticket')await NX.sb.from('tickets').update({title,notes,location:loc,priority:pri}).eq('id',card.id);
      else await NX.sb.from('kanban_cards').update({title,due_date:due,location:loc}).eq('id',card.id);
    }else{
      await NX.sb.from(TABLE).update({title,notes,due_date:due,location:loc,priority:pri,assignee,updated_at:new Date().toISOString()}).eq('id',card.id);
    }
    load();
  });
}

// Public API for creating cards from other modules (chat commands, triage)
NX.createCard=async function(data){
  if(useLegacy){
    if(data.priority==='urgent'){
      await NX.sb.from('tickets').insert({title:data.title,notes:data.notes,location:data.location,priority:data.priority,status:'open',reported_by:data.reported_by||NX.currentUser?.name||''});
    }else{
      await NX.sb.from('kanban_cards').insert({title:data.title,column_name:data.status||'todo',due_date:data.due_date,location:data.location});
    }
  }else{
    await NX.sb.from(TABLE).insert({
      title:data.title,notes:data.notes||null,status:data.status||'todo',
      assignee:data.assignee||null,location:data.location||null,
      due_date:data.due_date||null,priority:data.priority||'normal',
      tags:data.tags||[],source:data.source||'manual',source_ref:data.source_ref||null,
      photo_url:data.photo_url||null,ai_troubleshoot:data.ai_troubleshoot||null,
      reported_by:data.reported_by||NX.currentUser?.name||''
    });
  }
  NX.syslog&&NX.syslog('card_created',data.title);
};

NX.modules.board={init,show:load};
})();
