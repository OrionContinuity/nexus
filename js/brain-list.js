/* NEXUS Brain List v2 — Search, filters, community view, connected nodes */
(function(){
  let listViewOpen=false,listFilter='all',listSortMode='az',listCommunity='all',listDateRange='all',listConnectedTo=null;

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

        if(!q){res.classList.remove('open');if(listViewOpen)renderList();return;}

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
            const nameHtml=highlightMatch(n.name,q);
            const notePreview=(n.notes||'').slice(0,80);
            const tagStr=(n.tags||[]).slice(0,3).map(t=>'#'+t).join(' ');
            const commLabel=n.community_label?` · ${n.community_label.split(':')[0]}`:'';
            el.innerHTML=`<div class="sr-cat">${n.category}</div><div class="sr-main"><div class="sr-name">${nameHtml}</div><div class="sr-meta">${tagStr}${commLabel}${notePreview?' · '+notePreview.slice(0,50):''}</div></div>`;
            el.addEventListener('click',()=>{
              res.classList.remove('open');res.innerHTML='';inp.value='';
              NX.brain.state.searchHits=new Set();
              const particle=NX.brain.state.particles.find(p=>p.id===n.id);
              if(particle){NX.brain.state.frozenNode=particle;NX.brain.state.activeNode=n;NX.brain.openPanel(n);}
            });
            res.appendChild(el);
          });
        }else{res.classList.remove('open');}
        if(listViewOpen)renderList();
      },150);
    });

    document.addEventListener('click',e=>{
      if(!inp.contains(e.target)&&!res.contains(e.target)){res.classList.remove('open');res.innerHTML='';}
    });

    inp.addEventListener('keydown',e=>{
      const items=res.querySelectorAll('.sr-item');
      const active=res.querySelector('.sr-item.active');
      if(e.key==='ArrowDown'){e.preventDefault();if(!active&&items.length)items[0].classList.add('active');else if(active&&active.nextElementSibling){active.classList.remove('active');active.nextElementSibling.classList.add('active');}}
      else if(e.key==='ArrowUp'){e.preventDefault();if(active&&active.previousElementSibling){active.classList.remove('active');active.previousElementSibling.classList.add('active');}}
      else if(e.key==='Enter'){e.preventDefault();const sel=res.querySelector('.sr-item.active')||items[0];if(sel)sel.click();}
      else if(e.key==='Escape'){res.classList.remove('open');res.innerHTML='';inp.blur();}
    });
  }

  function highlightMatch(text,q){
    const idx=text.toLowerCase().indexOf(q);
    if(idx===-1)return text;
    return text.slice(0,idx)+'<mark>'+text.slice(idx,idx+q.length)+'</mark>'+text.slice(idx+q.length);
  }

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
    const nodes=NX.nodes.filter(n=>!n.is_private);

    // Category row
    const catRow=document.createElement('div');catRow.className='filter-row';
    ['all',...new Set(nodes.map(n=>n.category))].forEach(cat=>{
      const ch=document.createElement('button');ch.className='filter-chip'+(listFilter===cat?' active':'');
      ch.textContent=cat==='all'?'All':cat;
      ch.onclick=()=>{listFilter=cat;buildListFilters();renderList();};
      catRow.appendChild(ch);
    });
    fc.appendChild(catRow);

    // Community filter row
    const communities=new Map();
    nodes.forEach(n=>{
      if(n.community_id!=null&&n.community_label){
        const label=n.community_label.split(':')[0]||'Zone '+n.community_id;
        if(!communities.has(n.community_id))communities.set(n.community_id,{label,count:0});
        communities.get(n.community_id).count++;
      }
    });
    if(communities.size>1){
      const commRow=document.createElement('div');commRow.className='filter-row';
      const allBtn=document.createElement('button');allBtn.className='filter-chip filter-chip-comm'+(listCommunity==='all'?' active':'');
      allBtn.textContent='All Zones';
      allBtn.onclick=()=>{listCommunity='all';buildListFilters();renderList();};
      commRow.appendChild(allBtn);
      [...communities.entries()].sort((a,b)=>b[1].count-a[1].count).slice(0,8).forEach(([cid,info])=>{
        const ch=document.createElement('button');ch.className='filter-chip filter-chip-comm'+(listCommunity==cid?' active':'');
        ch.textContent=`${info.label} (${info.count})`;
        ch.onclick=()=>{listCommunity=cid;buildListFilters();renderList();};
        commRow.appendChild(ch);
      });
      fc.appendChild(commRow);
    }

    // Date range filter
    const dateRow=document.createElement('div');dateRow.className='filter-row';
    [{key:'all',label:'Any time'},{key:'7',label:'7 days'},{key:'30',label:'30 days'},{key:'90',label:'90 days'},{key:'old',label:'Older'}].forEach(d=>{
      const ch=document.createElement('button');ch.className='filter-chip filter-chip-date'+(listDateRange===d.key?' active':'');
      ch.textContent=d.label;
      ch.onclick=()=>{listDateRange=d.key;buildListFilters();renderList();};
      dateRow.appendChild(ch);
    });
    fc.appendChild(dateRow);

    // Connected-to indicator
    if(listConnectedTo){
      const connRow=document.createElement('div');connRow.className='filter-row';
      const connLabel=document.createElement('span');connLabel.className='filter-connected-label';
      connLabel.textContent='Connected to: '+listConnectedTo.name;
      const clearBtn=document.createElement('button');clearBtn.className='filter-chip active';
      clearBtn.textContent='✕ Clear';
      clearBtn.onclick=()=>{listConnectedTo=null;buildListFilters();renderList();};
      connRow.appendChild(connLabel);connRow.appendChild(clearBtn);
      fc.appendChild(connRow);
    }
  }

  function renderList(){
    const items=document.getElementById('listItems');items.innerHTML='';
    const q=document.getElementById('brainSearch').value.toLowerCase().trim();
    const now=Date.now();

    let f=NX.nodes.filter(n=>{
      if(n.is_private)return false;
      if(listFilter!=='all'&&n.category!==listFilter)return false;
      if(listCommunity!=='all'&&n.community_id!=listCommunity)return false;
      if(q&&!n.name.toLowerCase().includes(q)&&!(n.tags||[]).some(t=>t.includes(q))&&!(n.notes||'').toLowerCase().includes(q))return false;

      // Date filter
      if(listDateRange!=='all'){
        const relDate=n.last_relevant_date?new Date(n.last_relevant_date).getTime():0;
        const sources=n.source_emails||[];
        let newest=relDate;
        if(!newest&&sources.length){newest=sources.reduce((max,s)=>{const d=new Date(s.date||0).getTime();return d>max?d:max;},0);}
        if(listDateRange==='old'){if(newest>now-90*86400000)return false;}
        else{const days=parseInt(listDateRange);if(newest<now-days*86400000)return false;}
      }

      // Connected-to filter
      if(listConnectedTo){
        const connLinks=listConnectedTo.links||[];
        if(!connLinks.includes(n.id)&&n.id!==listConnectedTo.id)return false;
      }

      return true;
    });

    if(listSortMode==='az')f.sort((a,b)=>a.name.localeCompare(b.name));
    else if(listSortMode==='access')f.sort((a,b)=>(b.access_count||0)-(a.access_count||0));
    else f.sort((a,b)=>(b.id||0)-(a.id||0));

    // Count display
    const countEl=document.getElementById('listCount');
    if(countEl)countEl.textContent=f.length+' node'+(f.length!==1?'s':'');

    f.slice(0,200).forEach(n=>{
      const el=document.createElement('div');el.className='list-node';
      const role=n.community_role==='god'?' ★':n.community_role==='bridge'?' ◇':'';
      const linkCount=(n.links||[]).length;
      const age=n.last_relevant_date?timeAgo(n.last_relevant_date):'';
      const commTag=n.community_label?n.community_label.split(':')[0]:'';

      el.innerHTML=`<div class="list-node-cat">${n.category}${role}</div><div class="list-node-main"><div class="list-node-title">${n.name}</div><div class="list-node-notes">${(n.notes||'').slice(0,120)}</div><div class="list-node-footer">${linkCount?linkCount+' links':'no links'}${commTag?' · '+commTag:''}${age?' · '+age:''}</div></div>`;

      // Click to open node panel
      el.addEventListener('click',()=>NX.brain.openPanel(n));

      // Long press to show connected nodes
      let pressTimer=null;
      el.addEventListener('touchstart',()=>{pressTimer=setTimeout(()=>{listConnectedTo=n;buildListFilters();renderList();NX.toast('Showing nodes connected to '+n.name,'info');},500);});
      el.addEventListener('touchend',()=>{clearTimeout(pressTimer);});
      el.addEventListener('touchmove',()=>{clearTimeout(pressTimer);});

      items.appendChild(el);
    });

    if(!f.length){
      items.innerHTML='<div class="list-empty">No nodes match these filters</div>';
    }
  }

  function timeAgo(dateStr){
    try{
      const d=new Date(dateStr).getTime();
      const diff=Date.now()-d;
      const days=Math.floor(diff/86400000);
      if(days<1)return 'today';
      if(days<7)return days+'d ago';
      if(days<30)return Math.floor(days/7)+'w ago';
      if(days<365)return Math.floor(days/30)+'mo ago';
      return Math.floor(days/365)+'y ago';
    }catch(e){return '';}
  }

  // Public: show connected nodes from external call (e.g., node panel)
  NX.showConnected=function(node){
    listConnectedTo=node;
    // Open list view if not open
    if(!listViewOpen){
      document.getElementById('listToggle').click();
    }else{
      buildListFilters();renderList();
    }
  };

  function initList(){setupSearch();setupListView();}
  NX.brain.initList=initList;
})();
