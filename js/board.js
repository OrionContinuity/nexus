/* NEXUS Board v3 — Trello-level project management
   Multiple boards, custom lists, card details, checklists, labels, comments, drag, archive
*/
(function(){
let boards=[],activeBoard=null,lists=[],cards=[],dragCard=null,dragOverList=null;

const LABEL_COLORS=['#d45858','#e8a830','#5bba5f','#5b9bd5','#a88fd8','#d4a44e','#6b9bf0','#a49c94'];

async function loadBoards(){
  try{
    const{data}=await NX.sb.from('boards').select('*').eq('archived',false).order('position');
    boards=data||[];
    if(!boards.length){
      // Create default board
      const{data:nb}=await NX.sb.from('boards').insert({name:'Operations',color:'#c8a44e',position:0}).select().single();
      if(nb){boards=[nb];
        await NX.sb.from('board_lists').insert([
          {board_id:nb.id,name:'To Do',position:0},
          {board_id:nb.id,name:'In Progress',position:1},
          {board_id:nb.id,name:'Done',position:2}
        ]);
      }
    }
    if(!activeBoard&&boards.length)activeBoard=boards[0];
  }catch(e){console.error('Board load:',e);}
}

async function loadLists(){
  if(!activeBoard)return;
  try{
    const{data}=await NX.sb.from('board_lists').select('*').eq('board_id',activeBoard.id).order('position');
    lists=data||[];
  }catch(e){lists=[];}
}

async function loadCards(){
  if(!activeBoard)return;
  try{
    const{data}=await NX.sb.from('kanban_cards').select('*').eq('board_id',activeBoard.id).eq('archived',false).order('position');
    cards=data||[];
  }catch(e){cards=[];}
}

function render(){
  const wrap=document.getElementById('boardWrap');
  if(!wrap)return;
  wrap.innerHTML='';

  // Board selector
  const header=document.createElement('div');header.className='board-header';
  header.innerHTML=`<div class="board-selector">${boards.map(b=>
    `<button class="board-tab${b.id===activeBoard?.id?' active':''}" data-bid="${b.id}" style="border-color:${b.color}">${b.name}</button>`
  ).join('')}<button class="board-tab board-add-tab" id="addBoardBtn">+</button></div>`;
  wrap.appendChild(header);

  // Bind board tabs
  header.querySelectorAll('.board-tab[data-bid]').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      activeBoard=boards.find(b=>b.id==btn.dataset.bid);
      await loadLists();await loadCards();render();
    });
  });
  header.querySelector('#addBoardBtn')?.addEventListener('click',()=>promptNewBoard());

  // Lists container
  const listsWrap=document.createElement('div');listsWrap.className='board-lists';

  lists.forEach(list=>{
    const listEl=document.createElement('div');listEl.className='board-list';listEl.dataset.listId=list.id;

    // List header
    const lh=document.createElement('div');lh.className='board-list-header';
    const listCards=cards.filter(c=>c.list_id===list.id);
    lh.innerHTML=`<span class="board-list-name">${list.name}</span><span class="board-list-count">${listCards.length}</span>`;
    listEl.appendChild(lh);

    // Cards
    const cardsWrap=document.createElement('div');cardsWrap.className='board-list-cards';
    cardsWrap.dataset.listId=list.id;

    listCards.sort((a,b)=>(a.position||0)-(b.position||0)).forEach(card=>{
      const cardEl=createCardEl(card);
      cardsWrap.appendChild(cardEl);
    });

    // Drop zone
    cardsWrap.addEventListener('dragover',e=>{e.preventDefault();cardsWrap.classList.add('drag-over');dragOverList=list.id;});
    cardsWrap.addEventListener('dragleave',()=>cardsWrap.classList.remove('drag-over'));
    cardsWrap.addEventListener('drop',async e=>{
      e.preventDefault();cardsWrap.classList.remove('drag-over');
      if(dragCard&&dragCard.list_id!==list.id){
        await NX.sb.from('kanban_cards').update({list_id:list.id,column_name:list.name.toLowerCase().replace(/\s+/g,'_')}).eq('id',dragCard.id);
        dragCard.list_id=list.id;render();
      }
    });

    // Touch drag support
    cardsWrap.addEventListener('touchmove',e=>{e.preventDefault();},{passive:false});

    listEl.appendChild(cardsWrap);

    // Add card button
    const addBtn=document.createElement('button');addBtn.className='board-list-add';
    addBtn.textContent='+ Add card';
    addBtn.addEventListener('click',()=>promptNewCard(list.id));
    listEl.appendChild(addBtn);

    listsWrap.appendChild(listEl);
  });

  // Add list button
  const addListEl=document.createElement('div');addListEl.className='board-list board-list-new';
  addListEl.innerHTML='<button class="board-list-add-new">+ Add list</button>';
  addListEl.querySelector('button').addEventListener('click',()=>promptNewList());
  listsWrap.appendChild(addListEl);

  wrap.appendChild(listsWrap);
}

function createCardEl(card){
  const el=document.createElement('div');el.className='board-card';
  el.draggable=true;el.dataset.cardId=card.id;

  // Labels
  const labels=card.labels||[];
  let labelHtml='';
  if(labels.length){labelHtml='<div class="card-labels">'+labels.map(l=>`<span class="card-label" style="background:${l.color||'#a49c94'}">${l.name||''}</span>`).join('')+'</div>';}

  // Checklist progress
  const checklist=card.checklist||[];
  let checkHtml='';
  if(checklist.length){
    const done=checklist.filter(c=>c.done).length;
    checkHtml=`<span class="card-check-count">☑ ${done}/${checklist.length}</span>`;
  }

  // Due date
  let dueHtml='';
  if(card.due_date){
    const isOverdue=card.due_date<new Date().toISOString().split('T')[0];
    dueHtml=`<span class="card-due${isOverdue?' overdue':''}">${card.due_date}</span>`;
  }

  // Assignee
  const assignee=card.assignee?`<span class="card-assignee">${card.assignee}</span>`:'';

  // Comments count
  const comments=card.comments||[];
  const commentHtml=comments.length?`<span class="card-comment-count">💬 ${comments.length}</span>`:'';

  el.innerHTML=`${labelHtml}<div class="card-title">${card.title||'Untitled'}</div><div class="card-meta">${checkHtml}${dueHtml}${assignee}${commentHtml}</div>`;

  // Click to open detail
  el.addEventListener('click',e=>{if(!el.classList.contains('dragging'))openCardDetail(card);});

  // Drag
  el.addEventListener('dragstart',e=>{dragCard=card;el.classList.add('dragging');e.dataTransfer.effectAllowed='move';});
  el.addEventListener('dragend',()=>{el.classList.remove('dragging');dragCard=null;});

  // Touch drag
  let touchStartY=0,touchClone=null;
  el.addEventListener('touchstart',e=>{
    touchStartY=e.touches[0].clientY;
    dragCard=card;
  },{passive:true});
  el.addEventListener('touchend',e=>{
    if(touchClone){touchClone.remove();touchClone=null;}
    if(dragOverList&&dragCard&&dragCard.list_id!==dragOverList){
      NX.sb.from('kanban_cards').update({list_id:dragOverList,column_name:''}).eq('id',dragCard.id).then(()=>{
        dragCard.list_id=dragOverList;render();
      });
    }
    dragCard=null;dragOverList=null;
  },{passive:true});

  return el;
}

function openCardDetail(card){
  const modal=document.createElement('div');modal.className='card-detail-overlay';
  const labels=card.labels||[];
  const checklist=card.checklist||[];
  const comments=card.comments||[];

  modal.innerHTML=`<div class="card-detail">
    <div class="card-detail-header">
      <input class="card-detail-title" value="${(card.title||'').replace(/"/g,'&quot;')}" placeholder="Card title">
      <button class="card-detail-close">✕</button>
    </div>
    <div class="card-detail-body">
      <div class="card-detail-section">
        <div class="card-detail-label">Description</div>
        <textarea class="card-detail-desc" placeholder="Add details...">${card.description||''}</textarea>
      </div>
      <div class="card-detail-section">
        <div class="card-detail-label">Labels</div>
        <div class="card-detail-labels" id="cdLabels">${labels.map((l,i)=>`<span class="card-label" style="background:${l.color}">${l.name} <button class="label-remove" data-idx="${i}">✕</button></span>`).join('')}<button class="label-add-btn" id="cdAddLabel">+ Label</button></div>
      </div>
      <div class="card-detail-section">
        <div class="card-detail-label">Checklist</div>
        <div class="card-detail-checklist" id="cdChecklist">${checklist.map((c,i)=>`<div class="check-item"><input type="checkbox" ${c.done?'checked':''} data-idx="${i}"><span${c.done?' class="check-done"':''}>${c.text}</span></div>`).join('')}</div>
        <div class="check-add"><input placeholder="Add item..." id="cdCheckInput"><button id="cdCheckAdd">+</button></div>
      </div>
      <div class="card-detail-section">
        <div class="card-detail-label">Assignee</div>
        <input class="card-detail-assignee" value="${card.assignee||''}" placeholder="Who's responsible?" id="cdAssignee">
      </div>
      <div class="card-detail-section">
        <div class="card-detail-label">Due Date</div>
        <input type="date" class="card-detail-due" value="${card.due_date||''}" id="cdDue">
      </div>
      <div class="card-detail-section">
        <div class="card-detail-label">Comments (${comments.length})</div>
        <div class="card-detail-comments" id="cdComments">${comments.map(c=>`<div class="comment-item"><span class="comment-by">${c.by||'?'}</span><span class="comment-time">${c.at?new Date(c.at).toLocaleDateString():''}</span><div class="comment-text">${c.text}</div></div>`).join('')}</div>
        <div class="comment-add"><input placeholder="Write a comment..." id="cdCommentInput"><button id="cdCommentAdd">Post</button></div>
      </div>
      <div class="card-detail-actions">
        <button class="card-archive-btn" id="cdArchive">Archive Card</button>
      </div>
    </div>
  </div>`;

  document.body.appendChild(modal);

  // Close
  modal.querySelector('.card-detail-close').onclick=()=>saveAndClose(card,modal);
  modal.addEventListener('click',e=>{if(e.target===modal)saveAndClose(card,modal);});

  // Checklist checkboxes
  modal.querySelectorAll('.check-item input[type=checkbox]').forEach(cb=>{
    cb.addEventListener('change',()=>{
      const idx=parseInt(cb.dataset.idx);
      checklist[idx].done=cb.checked;
      cb.nextElementSibling.classList.toggle('check-done',cb.checked);
    });
  });

  // Add checklist item
  modal.querySelector('#cdCheckAdd').onclick=()=>{
    const inp=modal.querySelector('#cdCheckInput');
    const text=inp.value.trim();if(!text)return;
    checklist.push({text,done:false});
    const cl=modal.querySelector('#cdChecklist');
    const idx=checklist.length-1;
    cl.innerHTML+=`<div class="check-item"><input type="checkbox" data-idx="${idx}"><span>${text}</span></div>`;
    inp.value='';
    // Re-bind checkboxes
    cl.querySelectorAll('input[type=checkbox]').forEach(cb=>{
      cb.onchange=()=>{checklist[parseInt(cb.dataset.idx)].done=cb.checked;cb.nextElementSibling.classList.toggle('check-done',cb.checked);};
    });
  };
  modal.querySelector('#cdCheckInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();modal.querySelector('#cdCheckAdd').click();}});

  // Add comment
  modal.querySelector('#cdCommentAdd').onclick=()=>{
    const inp=modal.querySelector('#cdCommentInput');
    const text=inp.value.trim();if(!text)return;
    const comment={text,by:NX.currentUser?.name||'?',at:new Date().toISOString()};
    comments.push(comment);
    modal.querySelector('#cdComments').innerHTML+=`<div class="comment-item"><span class="comment-by">${comment.by}</span><span class="comment-time">${new Date().toLocaleDateString()}</span><div class="comment-text">${text}</div></div>`;
    inp.value='';
  };
  modal.querySelector('#cdCommentInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();modal.querySelector('#cdCommentAdd').click();}});

  // Add label
  modal.querySelector('#cdAddLabel').onclick=()=>{
    const name=prompt('Label name:');if(!name)return;
    const color=LABEL_COLORS[labels.length%LABEL_COLORS.length];
    labels.push({name,color});
    const container=modal.querySelector('#cdLabels');
    const btn=container.querySelector('.label-add-btn');
    const span=document.createElement('span');span.className='card-label';span.style.background=color;
    span.innerHTML=`${name} <button class="label-remove" data-idx="${labels.length-1}">✕</button>`;
    container.insertBefore(span,btn);
  };

  // Archive
  modal.querySelector('#cdArchive').onclick=async()=>{
    if(!confirm('Archive this card?'))return;
    await NX.sb.from('kanban_cards').update({archived:true}).eq('id',card.id);
    modal.remove();await loadCards();render();
    NX.toast('Card archived','info');
  };
}

async function saveAndClose(card,modal){
  const title=modal.querySelector('.card-detail-title').value.trim();
  const desc=modal.querySelector('.card-detail-desc').value.trim();
  const assignee=modal.querySelector('#cdAssignee').value.trim();
  const dueDate=modal.querySelector('#cdDue').value||null;
  const checklist=card.checklist||[];
  const comments=card.comments||[];
  const labels=card.labels||[];

  await NX.sb.from('kanban_cards').update({
    title:title||card.title,
    description:desc,
    assignee:assignee||null,
    due_date:dueDate,
    checklist,comments,labels,
  }).eq('id',card.id);

  modal.remove();
  await loadCards();render();
}

async function promptNewCard(listId){
  const title=prompt('Card title:');if(!title)return;
  await NX.sb.from('kanban_cards').insert({
    title,board_id:activeBoard.id,list_id:listId,
    column_name:'',position:cards.filter(c=>c.list_id===listId).length,
    checklist:[],comments:[],labels:[],archived:false
  });
  await loadCards();render();
  NX.toast('Card created','success');
}

async function promptNewList(){
  const name=prompt('List name:');if(!name)return;
  await NX.sb.from('board_lists').insert({
    board_id:activeBoard.id,name,position:lists.length
  });
  await loadLists();render();
}

async function promptNewBoard(){
  const name=prompt('Board name:');if(!name)return;
  const color=LABEL_COLORS[boards.length%LABEL_COLORS.length];
  const{data}=await NX.sb.from('boards').insert({name,color,position:boards.length}).select().single();
  if(data){
    boards.push(data);activeBoard=data;
    await NX.sb.from('board_lists').insert([
      {board_id:data.id,name:'To Do',position:0},
      {board_id:data.id,name:'In Progress',position:1},
      {board_id:data.id,name:'Done',position:2}
    ]);
    await loadLists();await loadCards();render();
    NX.toast('Board created','success');
  }
}

async function init(){
  await loadBoards();await loadLists();await loadCards();render();
}

async function show(){
  await loadBoards();await loadLists();await loadCards();render();
}

NX.modules.board={init,show};
})();
