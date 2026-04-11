/* NEXUS Brain List — Search with live dropdown, list view, filters */
(function(){
  let listViewOpen=false,listFilter='all',listSortMode='az';

  function setupSearch(){
    const inp=document.getElementById('brainSearch'),res=document.getElementById('searchResults');
    let debounce=null;

    inp.addEventListener('input',()=>{
      clearTimeout(debounce);
      debounce=setTimeout(()=>{
        NX.brain.wakePhysics();
        const q=inp.value.toLowerCase().trim();
        NX.brain.state.searchHits=new Set();
        res.innerHTML='';

        if(!q){res.classList.remove('open');return;}

        const matches=NX.nodes.filter(n=>!n.is_private).map(n=>{
          let score=0;
          const name=(n.name||'').toLowerCase();
          const notes=(n.notes||'').toLowerCase();
          const tags=(n.tags||[]).join(' ').toLowerCase();
          if(name===q)score+=100;
          else if(name.startsWith(q))score+=50;
          else if(name.includes(q))score+=20;
          if(tags.includes(q))score+=10;
          if(notes.includes(q))score+=5;
          return{node:n,score};
        }).filter(s=>s.score>0).sort((a,b)=>b.score-a.score).slice(0,12);

        matches.forEach(m=>NX.brain.state.searchHits.add(m.node.id));

        if(matches.length){
          res.classList.add('open');
          matches.forEach(m=>{
            const n=m.node;
            const el=document.createElement('div');el.className='sr-item';
            // Highlight match in name
            const nameHtml=highlightMatch(n.name,q);
            const notePreview=(n.notes||'').slice(0,80);
            const tagStr=(n.tags||[]).slice(0,3).map(t=>'#'+t).join(' ');
            el.innerHTML=`<div class="sr-cat">${n.category}</div><div class="sr-main"><div class="sr-name">${nameHtml}</div><div class="sr-meta">${tagStr}${notePreview?' · '+notePreview.slice(0,50):''}</div></div>`;
            el.addEventListener('click',()=>{
              res.classList.remove('open');res.innerHTML='';
              inp.value='';
              NX.brain.state.searchHits=new Set();
              // Navigate to node
              const particle=NX.brain.state.particles.find(p=>p.id===n.id);
              if(particle){NX.brain.state.frozenNode=particle;NX.brain.state.activeNode=n;NX.brain.openPanel(n);}
            });
            res.appendChild(el);
          });
        }else{res.classList.remove('open');}
      },150);
    });

    // Close dropdown on outside click
    document.addEventListener('click',e=>{
      if(!inp.contains(e.target)&&!res.contains(e.target)){res.classList.remove('open');res.innerHTML='';}
    });

    // Keyboard navigation
    inp.addEventListener('keydown',e=>{
      const items=res.querySelectorAll('.sr-item');
      const active=res.querySelector('.sr-item.active');
      if(e.key==='ArrowDown'){
        e.preventDefault();
        if(!active&&items.length)items[0].classList.add('active');
        else if(active&&active.nextElementSibling){active.classList.remove('active');active.nextElementSibling.classList.add('active');}
      }else if(e.key==='ArrowUp'){
        e.preventDefault();
        if(active&&active.previousElementSibling){active.classList.remove('active');active.previousElementSibling.classList.add('active');}
      }else if(e.key==='Enter'){
        e.preventDefault();
        const sel=res.querySelector('.sr-item.active')||items[0];
        if(sel)sel.click();
      }else if(e.key==='Escape'){
        res.classList.remove('open');res.innerHTML='';inp.blur();
      }
    });
  }

  function highlightMatch(text,q){
    const idx=text.toLowerCase().indexOf(q);
    if(idx===-1)return text;
    return text.slice(0,idx)+'<mark>'+text.slice(idx,idx+q.length)+'</mark>'+text.slice(idx+q.length);
  }

  // Tag search — called when tapping a tag
  NX.searchByTag=function(tag){
    const inp=document.getElementById('brainSearch');
    if(inp){inp.value=tag;inp.dispatchEvent(new Event('input'));}
  };

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
