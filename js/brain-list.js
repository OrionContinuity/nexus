/* NEXUS Brain List — Search, list view, filters */
(function(){
  let listViewOpen=false,listFilter='all',listSortMode='az';

  function setupSearch(){
    const inp=document.getElementById('brainSearch'),res=document.getElementById('searchResults');
    inp.addEventListener('input',()=>{
      NX.brain.wakePhysics();
      const q=inp.value.toLowerCase().trim();
      NX.brain.state.searchHits=new Set();res.innerHTML='';res.classList.remove('open');
      if(!q)return;
      const m=NX.nodes.filter(n=>!n.is_private&&(n.name.toLowerCase().includes(q)||(n.tags||[]).some(t=>t.includes(q))||(n.notes||'').toLowerCase().includes(q)));
      m.forEach(n=>NX.brain.state.searchHits.add(n.id));
    });
  }

  function setupListView(){
    document.getElementById('listToggle').addEventListener('click',()=>{
      listViewOpen=!listViewOpen;const lv=document.getElementById('listView'),btn=document.getElementById('listToggle');
      if(listViewOpen){btn.classList.add('on');lv.classList.add('open');buildListFilters();renderList();}
      else{btn.classList.remove('on');lv.classList.remove('open');}
    });
    document.querySelectorAll('.sort-btn').forEach(b=>b.addEventListener('click',()=>{
      document.querySelectorAll('.sort-btn').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');listSortMode=b.dataset.sort;renderList();
    }));
  }

  function buildListFilters(){
    const fc=document.getElementById('listFilters');fc.innerHTML='';
    ['all',...new Set(NX.nodes.filter(n=>!n.is_private).map(n=>n.category))].forEach(cat=>{
      const ch=document.createElement('button');ch.className='filter-chip'+(listFilter===cat?' active':'');
      ch.textContent=cat==='all'?'All':cat;
      ch.onclick=()=>{listFilter=cat;buildListFilters();renderList();};
      fc.appendChild(ch);
    });
  }

  function renderList(){
    const items=document.getElementById('listItems');items.innerHTML='';
    const q=document.getElementById('brainSearch').value.toLowerCase().trim();
    let f=NX.nodes.filter(n=>!n.is_private&&(listFilter==='all'||n.category===listFilter)&&(!q||n.name.toLowerCase().includes(q)||(n.tags||[]).some(t=>t.includes(q))||(n.notes||'').toLowerCase().includes(q)));
    if(listSortMode==='az')f.sort((a,b)=>a.name.localeCompare(b.name));
    else if(listSortMode==='access')f.sort((a,b)=>(b.access_count||0)-(a.access_count||0));
    else f.sort((a,b)=>(b.id||0)-(a.id||0));
    f.slice(0,200).forEach(n=>{const el=document.createElement('div');el.className='list-node';
      el.innerHTML=`<div class="list-node-cat">${n.category}</div><div class="list-node-title">${n.name}</div><div class="list-node-notes">${(n.notes||'').slice(0,120)}</div>`;
      el.onclick=()=>NX.brain.openPanel(n);items.appendChild(el);
    });
  }

  function initList(){setupSearch();setupListView();}
  NX.brain.initList=initList;
})();
