/* ═══════════════════════════════════════════
   NEXUS — Board Module (board.js)
   Kanban with HTML5 Drag & Drop
   ═══════════════════════════════════════════ */
(function(){
let cards=[];
const COLS=['todo','in_progress','done'];
const LABELS={todo:'To Do',in_progress:'In Progress',done:'Done'};

async function init(){await load();}

async function load(){
  try{const r=await NX.sb.from('kanban_cards').select('*').order('created_at',{ascending:true}).limit(100);cards=r.data||[];}catch(e){}
  render();
}

function render(){
  const container=document.getElementById('boardContainer');container.innerHTML='';
  COLS.forEach(col=>{
    const cc=cards.filter(c=>c.column_name===col);
    const colEl=document.createElement('div');colEl.className='board-col';colEl.dataset.col=col;

    colEl.innerHTML=`<div class="board-col-header">${LABELS[col]}<span class="board-col-count">${cc.length}</span></div>`;
    const body=document.createElement('div');body.className='board-col-body';

    // Drop zone
    colEl.addEventListener('dragover',e=>{e.preventDefault();colEl.classList.add('drag-over');});
    colEl.addEventListener('dragleave',()=>colEl.classList.remove('drag-over'));
    colEl.addEventListener('drop',async e=>{
      e.preventDefault();colEl.classList.remove('drag-over');
      const cardId=e.dataTransfer.getData('text/plain');
      if(!cardId)return;
      const card=cards.find(c=>String(c.id)===cardId);
      if(card&&card.column_name!==col){
        card.column_name=col;render();
        try{await NX.sb.from('kanban_cards').update({column_name:col}).eq('id',card.id);}catch(e){}
      }
    });

    cc.forEach(card=>{
      const el=document.createElement('div');el.className='board-card';
      el.draggable=true;el.dataset.id=card.id;
      el.innerHTML=`${card.title}<div class="board-card-meta">${card.location||''}${card.due_date?' · '+card.due_date:''}</div>`;
      el.addEventListener('dragstart',e=>{
        e.dataTransfer.setData('text/plain',String(card.id));
        el.classList.add('dragging');
        setTimeout(()=>el.style.display='none',0);
      });
      el.addEventListener('dragend',()=>{
        el.classList.remove('dragging');el.style.display='';
      });

      // Touch drag fallback
      let touchClone=null;
      el.addEventListener('touchstart',e=>{
        const touch=e.touches[0];
        touchClone=el.cloneNode(true);
        touchClone.style.cssText='position:fixed;z-index:1000;opacity:0.7;pointer-events:none;width:'+el.offsetWidth+'px';
        document.body.appendChild(touchClone);
        el._touchData={id:card.id,startX:touch.clientX,startY:touch.clientY};
      },{passive:true});
      el.addEventListener('touchmove',e=>{
        if(!touchClone)return;const touch=e.touches[0];
        touchClone.style.left=touch.clientX-50+'px';touchClone.style.top=touch.clientY-20+'px';
      },{passive:true});
      el.addEventListener('touchend',async e=>{
        if(touchClone){touchClone.remove();touchClone=null;}
        if(!el._touchData)return;
        const touch=e.changedTouches[0];
        const dropEl=document.elementFromPoint(touch.clientX,touch.clientY);
        const colEl2=dropEl?.closest('.board-col');
        if(colEl2){
          const targetCol=colEl2.dataset.col;
          const card2=cards.find(c=>String(c.id)===String(el._touchData.id));
          if(card2&&card2.column_name!==targetCol){
            card2.column_name=targetCol;render();
            try{await NX.sb.from('kanban_cards').update({column_name:targetCol}).eq('id',card2.id);}catch(e){}
          }
        }
        el._touchData=null;
      });

      body.appendChild(el);
    });

    // Add card
    const addBtn=document.createElement('button');addBtn.className='board-add';addBtn.textContent='+ Add';
    addBtn.onclick=async()=>{const t=prompt('Card title:');if(!t)return;
      try{await NX.sb.from('kanban_cards').insert({title:t,column_name:col});}catch(e){}load();};
    body.appendChild(addBtn);
    colEl.appendChild(body);container.appendChild(colEl);
  });
}

NX.modules.board={init,show:load};
})();
