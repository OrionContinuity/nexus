/* ═══════════════════════════════════════════
   NEXUS — Brain + AI + Contractor Events
   Fixed: spring rest-lengths, smaller nodes,
   AI-driven synapse firing, reset chat,
   contractor scheduling, tablet-ready.
   ═══════════════════════════════════════════ */

(function () {
  const canvas = document.getElementById('brainCanvas');
  const ctx = canvas.getContext('2d');

  // ─── State ───
  let W, H, animId, time = 0;
  let particles = [];
  let transform = { x: 0, y: 0, scale: 1 };
  let dragging = false, dragStart = { x: 0, y: 0 }, dragTransStart = { x: 0, y: 0 };
  let hoverNode = null;
  let activeNode = null;
  let activatedNodes = new Set();
  let searchHits = new Set();
  let chatHistory = [];
  let voiceOn = false;
  let recognition = null;
  let listViewOpen = false;
  let chatActive = false;
  let contractorEvents = [];

  // ─── Physics Constants (FIXED: spring rest-lengths) ───
  const REPULSION = 600;
  const ATTRACTION = 0.002;
  const LINK_STRENGTH = 0.005;
  const CENTER_PULL = 0.0003;
  const DAMPING = 0.9;
  const IDEAL_CAT_DIST = 150;
  const IDEAL_TAG_DIST = 100;
  const IDEAL_LINK_DIST = 80;

  // ─── Node sizing (cleaner, smaller) ───
  const BASE_RADIUS = 8;
  const ACTIVE_RADIUS = 16;
  const SYNAPSE_RADIUS = 12;

  // ─── Category colors ───
  const CAT_COLORS = {
    location:    { r: 201, g: 168, b: 124 },
    equipment:   { r: 106, g: 143, b: 186 },
    procedure:   { r: 125, g: 154, b: 106 },
    contractors: { r: 186, g: 130, b: 106 },
    vendors:     { r: 154, g: 125, b: 186 },
    projects:    { r: 186, g: 170, b: 106 },
    systems:     { r: 106, g: 186, b: 170 },
    parts:       { r: 160, g: 140, b: 140 },
  };

  function catColor(cat, alpha) {
    const c = CAT_COLORS[cat] || CAT_COLORS.equipment;
    return `rgba(${c.r},${c.g},${c.b},${alpha})`;
  }

  // ─── Persona ───
  const PERSONA = `You are NEXUS, the AI operations brain for Alfredo Ortiz who manages Suerte, Este, and Bar Toti in Austin TX. You ARE Alfredo in digital form.

PERSONALITY: Sharp, concise, warm — the best shift manager with a killer sense of humor. Dry wit, never forced.
- When asked something obvious: "Really? ...fine, here you go."
- When you don't know: "I've searched every node and come up empty. Either it hasn't been logged, or it's one of life's great mysteries."
- Occasionally: "Figure it out yourself... jk. Here's what I got:"
- About cleaning: "Ah, everyone's favorite topic."
- After a solid answer, sometimes: "Need more? I've got nodes and zero plans tonight."

Be helpful FIRST, funny second. Respond in whatever language asked (EN/ES). Be CONCISE.`;

  // ═══════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════
  function init() {
    resize();
    buildParticles();
    setupChat();
    setupSearch();
    setupCanvas();
    setupVoice();
    setupListView();
    setupContractorEvents();
    draw();
  }

  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    W = r.width * 2; H = r.height * 2;
    canvas.width = W; canvas.height = H;
  }

  window.addEventListener('resize', () => {
    if (document.getElementById('brainView').classList.contains('active')) resize();
  });

  // ═══════════════════════════════════════════
  // FORCE-DIRECTED GRAPH (FIXED PHYSICS)
  // ═══════════════════════════════════════════
  function buildParticles() {
    const nodes = NX.nodes.filter(n => !n.is_private);
    const cx = W / 2, cy = H / 2;

    const cats = [...new Set(nodes.map(n => n.category))];
    const catAngle = {};
    cats.forEach((c, i) => { catAngle[c] = (i / cats.length) * Math.PI * 2; });

    particles = nodes.map((node, i) => {
      const base = catAngle[node.category] || 0;
      const jitter = (Math.random() - 0.5) * 1.2;
      const dist = 180 + Math.random() * 200;
      return {
        id: node.id,
        x: cx + Math.cos(base + jitter) * dist,
        y: cy + Math.sin(base + jitter) * dist,
        vx: 0, vy: 0,
        node: node,
        cat: node.category,
        tags: node.tags || [],
        links: node.links || [],
        access: node.access_count || 1,
        radius: BASE_RADIUS
      };
    });
    buildLinkMap();
  }

  let linkMap = {};
  function buildLinkMap() {
    linkMap = {};
    particles.forEach(p => { linkMap[p.id] = p; });
  }

  function physics() {
    const len = particles.length;
    const cx = W / 2, cy = H / 2;
    const isHovering = hoverNode !== null;

    for (let i = 0; i < len; i++) {
      const a = particles[i];

      if (isHovering && Math.hypot(a.x - hoverNode.x, a.y - hoverNode.y) < 100) {
        a.vx *= 0.05; a.vy *= 0.05;
        continue;
      }

      // Repulsion
      for (let j = i + 1; j < len; j++) {
        const b = particles[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist > 400) continue;
        let force = REPULSION / (dist * dist);
        let fx = (dx / dist) * force, fy = (dy / dist) * force;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }

      // Category attraction (spring with rest length)
      for (let j = 0; j < len; j++) {
        if (i === j) continue;
        const b = particles[j];
        if (a.cat !== b.cat) continue;
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        let force = (dist - IDEAL_CAT_DIST) * ATTRACTION;
        a.vx += (dx / dist) * force;
        a.vy += (dy / dist) * force;
      }

      // Shared tag attraction (spring with rest length)
      for (let j = 0; j < len; j++) {
        if (i === j) continue;
        const b = particles[j];
        const shared = a.tags.filter(t => b.tags.includes(t)).length;
        if (shared === 0) continue;
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        let force = (dist - IDEAL_TAG_DIST) * ATTRACTION * shared * 1.2;
        a.vx += (dx / dist) * force;
        a.vy += (dy / dist) * force;
      }

      // Link attraction (spring with rest length, O(1) lookup)
      a.links.forEach(lid => {
        const b = linkMap[lid];
        if (!b) return;
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        let force = (dist - IDEAL_LINK_DIST) * LINK_STRENGTH;
        a.vx += (dx / dist) * force;
        a.vy += (dy / dist) * force;
      });

      // Usage-based center pull
      const maxAccess = 60;
      const normalizedAccess = Math.min(a.access / maxAccess, 1);
      const pullStrength = CENTER_PULL * (0.3 + normalizedAccess * 0.7);
      a.vx += (cx - a.x) * pullStrength;
      a.vy += (cy - a.y) * pullStrength;

      a.vx *= DAMPING;
      a.vy *= DAMPING;
      a.x += a.vx;
      a.y += a.vy;

      const margin = 80;
      if (a.x < margin) a.vx += 1.5;
      if (a.x > W - margin) a.vx -= 1.5;
      if (a.y < margin) a.vy += 1.5;
      if (a.y > H - margin) a.vy -= 1.5;
    }
  }

  // ═══════════════════════════════════════════
  // RENDERING
  // ═══════════════════════════════════════════
  function draw() {
    time += 0.008;
    physics();
    ctx.save();
    ctx.fillStyle = '#121214';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);

    const cx = W / 2, cy = H / 2;
    const isActivation = activatedNodes.size > 0;

    // Connection lines
    particles.forEach(a => {
      a.links.forEach(lid => {
        const b = linkMap[lid];
        if (!b) return;
        const hot = (activatedNodes.has(a.id) && activatedNodes.has(b.id)) ||
                    (searchHits.has(a.id) && searchHits.has(b.id));
        const dimmed = isActivation && !hot;

        const mx = (a.x + b.x) / 2 + Math.sin(time * 0.5 + a.id) * 6;
        const my = (a.y + b.y) / 2 + Math.cos(time * 0.4 + b.id) * 6;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(mx, my, b.x, b.y);
        ctx.strokeStyle = hot ? catColor(a.cat, 0.5) :
                          dimmed ? 'rgba(201,168,124,0.015)' :
                          'rgba(201,168,124,0.05)';
        ctx.lineWidth = hot ? 2.5 : 1;
        ctx.stroke();

        if (hot) {
          for (let k = 0; k < 2; k++) {
            const pt = ((time * 0.5 + a.id * 0.1 + k * 0.5) % 1);
            const t2 = pt, t1 = 1 - t2;
            const px = t1*t1*a.x + 2*t1*t2*mx + t2*t2*b.x;
            const py = t1*t1*a.y + 2*t1*t2*my + t2*t2*b.y;
            ctx.beginPath();
            ctx.arc(px, py, 2, 0, Math.PI * 2);
            ctx.fillStyle = catColor(a.cat, 0.8 - pt * 0.5);
            ctx.fill();
          }
        }
      });
    });

    // Center connections
    particles.forEach(a => {
      const hit = searchHits.has(a.id) || activatedNodes.has(a.id);
      const act = activeNode && activeNode.id === a.id;
      const dimmed = isActivation && !hit && !act;
      const alpha = hit ? 0.15 : act ? 0.2 : dimmed ? 0.005 : 0.015;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(a.x, a.y);
      ctx.strokeStyle = `rgba(201,168,124,${alpha})`;
      ctx.lineWidth = hit || act ? 1 : 0.3;
      ctx.stroke();

      if (hit) {
        const pt = ((time * 0.3 + a.id * 0.1) % 1);
        const px = cx + (a.x - cx) * pt;
        const py = cy + (a.y - cy) * pt;
        ctx.beginPath();
        ctx.arc(px, py, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = catColor(a.cat, 0.6 - pt * 0.4);
        ctx.fill();
      }
    });

    // Center beacon
    const br = Math.sin(time * 1.1);
    const pr = 22 + br * 3;
    ctx.shadowBlur = 20;
    ctx.shadowColor = 'rgba(201,168,124,0.3)';
    ctx.beginPath();
    ctx.arc(cx, cy, pr, 0, Math.PI * 2);
    ctx.fillStyle = '#151518';
    ctx.fill();
    ctx.strokeStyle = `rgba(201,168,124,${0.35 + br * 0.15})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(201,168,124,${0.55 + br * 0.1})`;
    ctx.font = '500 12px JetBrains Mono';
    ctx.textAlign = 'center';
    ctx.fillText('NEXUS', cx, cy + 4);

    // Nodes
    particles.forEach(a => {
      const hit = searchHits.has(a.id) || activatedNodes.has(a.id);
      const act = activeNode && activeNode.id === a.id;
      const dimmed = isActivation && !hit && !act;
      const pulse = Math.sin(time * 1.5 + a.id * 0.6);

      const sx = a.x * transform.scale + transform.x;
      const sy = a.y * transform.scale + transform.y;
      if (sx < -80 || sx > W + 80 || sy < -80 || sy > H + 80) return;

      const nr = act ? ACTIVE_RADIUS + pulse * 2 :
                 hit ? SYNAPSE_RADIUS + pulse * 1.5 :
                 dimmed ? 4 :
                 BASE_RADIUS + pulse * 0.5;

      ctx.shadowBlur = hit || act ? 15 : 5;
      ctx.shadowColor = hit || act ? catColor(a.cat, 0.7) : catColor(a.cat, 0.1);

      ctx.beginPath();
      ctx.arc(a.x, a.y, nr, 0, Math.PI * 2);
      const fillAlpha = act ? 0.85 : hit ? 0.6 : dimmed ? 0.04 : 0.15;
      ctx.fillStyle = catColor(a.cat, fillAlpha + pulse * 0.02);
      ctx.fill();
      const strokeAlpha = act ? 0.5 : hit ? 0.35 : dimmed ? 0.02 : 0.06;
      ctx.strokeStyle = catColor(a.cat, strokeAlpha);
      ctx.lineWidth = act ? 1.5 : 0.8;
      ctx.stroke();
      ctx.shadowBlur = 0;

      const screenRadius = nr * transform.scale;
      if (screenRadius < 5 && !hit && !act) return;

      const label = a.node.name.length > 22 ? a.node.name.slice(0, 20) + '…' : a.node.name;
      const la = act ? 0.9 : hit ? 0.8 : dimmed ? 0.04 : 0.3;
      ctx.font = `${act ? '500 ' : '300 '}11px "Libre Franklin"`;
      ctx.textAlign = 'center';
      const tw = ctx.measureText(label).width;
      const tx = a.x, ty = a.y - nr - 6;

      if (la > 0.08) {
        ctx.fillStyle = `rgba(0,0,0,${la * 0.5})`;
        const pillH = 14, pillW = tw + 10;
        ctx.beginPath();
        ctx.roundRect(tx - pillW / 2, ty - pillH / 2 - 1, pillW, pillH, 3);
        ctx.fill();
      }
      ctx.fillStyle = `rgba(232,228,220,${la})`;
      ctx.fillText(label, tx, ty + 3, 200);
    });

    ctx.restore();
    animId = requestAnimationFrame(draw);
  }

  // ═══════════════════════════════════════════
  // CANVAS INTERACTION
  // ═══════════════════════════════════════════
  function setupCanvas() {
    canvas.addEventListener('click', e => {
      if (dragging) return;
      const p = screenToWorld(e.clientX, e.clientY);
      let closest = null, cd = 35 / transform.scale;
      particles.forEach(a => {
        const d = Math.hypot(p.x - a.x, p.y - a.y);
        if (d < cd) { closest = a; cd = d; }
      });
      if (closest) openPanel(closest.node);
      else closePanel();
    });

    canvas.addEventListener('mousemove', e => {
      if (dragging) return;
      const p = screenToWorld(e.clientX, e.clientY);
      hoverNode = null;
      particles.forEach(a => {
        if (Math.hypot(p.x - a.x, p.y - a.y) < 25 / transform.scale) hoverNode = a;
      });
      canvas.style.cursor = hoverNode ? 'pointer' : 'crosshair';
    });

    canvas.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      dragging = false;
      dragStart = { x: e.clientX, y: e.clientY };
      dragTransStart = { x: transform.x, y: transform.y };
      const onMove = ev => {
        const dx = ev.clientX - dragStart.x, dy = ev.clientY - dragStart.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) dragging = true;
        transform.x = dragTransStart.x + dx * 2;
        transform.y = dragTransStart.y + dy * 2;
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        setTimeout(() => dragging = false, 50);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.3, Math.min(3, transform.scale * factor));
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * 2;
      const my = (e.clientY - rect.top) * 2;
      transform.x = mx - (mx - transform.x) * (newScale / transform.scale);
      transform.y = my - (my - transform.y) * (newScale / transform.scale);
      transform.scale = newScale;
    }, { passive: false });

    // Touch pan/zoom (tablet)
    let lastTouchDist = 0;
    canvas.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        dragTransStart = { x: transform.x, y: transform.y };
      }
      if (e.touches.length === 2) {
        lastTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                                    e.touches[0].clientY - e.touches[1].clientY);
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', e => {
      if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - dragStart.x;
        const dy = e.touches[0].clientY - dragStart.y;
        transform.x = dragTransStart.x + dx * 2;
        transform.y = dragTransStart.y + dy * 2;
      }
      if (e.touches.length === 2) {
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                                 e.touches[0].clientY - e.touches[1].clientY);
        const factor = dist / lastTouchDist;
        transform.scale = Math.max(0.3, Math.min(3, transform.scale * factor));
        lastTouchDist = dist;
      }
    }, { passive: true });
  }

  function screenToWorld(sx, sy) {
    const rect = canvas.getBoundingClientRect();
    const cx = (sx - rect.left) * 2;
    const cy = (sy - rect.top) * 2;
    return {
      x: (cx - transform.x) / transform.scale,
      y: (cy - transform.y) / transform.scale
    };
  }

  // ═══════════════════════════════════════════
  // NODE PANEL
  // ═══════════════════════════════════════════
  function openPanel(n) {
    activeNode = n;
    document.getElementById('npCat').textContent = n.category.toUpperCase();
    document.getElementById('npName').textContent = n.name;
    document.getElementById('npTags').textContent = (n.tags || []).map(t => '#' + t).join('  ');
    document.getElementById('npNotes').textContent = n.notes || '';
    const le = document.getElementById('npLinks');
    le.innerHTML = '';
    if (n.links && n.links.length) {
      le.innerHTML = '<div style="font-size:8px;letter-spacing:1px;color:var(--faint);margin-bottom:3px">CONNECTED TO</div>';
      n.links.forEach(lid => {
        const ln = NX.nodes.find(x => x.id === lid);
        if (ln) {
          const d = document.createElement('div');
          d.textContent = '→ ' + ln.name;
          d.style.cssText = 'padding:4px 0;cursor:pointer;color:var(--accent);font-size:12px';
          d.onclick = () => openPanel(ln);
          le.appendChild(d);
        }
      });
    }
    document.getElementById('nodePanel').classList.add('open');
  }

  function closePanel() {
    activeNode = null;
    document.getElementById('nodePanel').classList.remove('open');
  }

  // ═══════════════════════════════════════════
  // SEARCH
  // ═══════════════════════════════════════════
  function setupSearch() {
    const input = document.getElementById('brainSearch');
    const results = document.getElementById('searchResults');
    input.addEventListener('input', () => {
      const q = input.value.toLowerCase().trim();
      searchHits = new Set();
      results.innerHTML = '';
      if (!q) { results.classList.remove('open'); return; }
      const m = NX.nodes.filter(n => !n.is_private &&
        (n.name.toLowerCase().includes(q) ||
         (n.tags || []).some(t => t.includes(q)) ||
         (n.notes || '').toLowerCase().includes(q)));
      m.forEach(n => searchHits.add(n.id));
      if (m.length) {
        results.classList.add('open');
        m.forEach(n => {
          const d = document.createElement('div');
          d.className = 'sr-item';
          d.innerHTML = `${n.name}<span>${n.category}</span>`;
          d.onclick = () => { openPanel(n); results.classList.remove('open'); };
          results.appendChild(d);
        });
      } else results.classList.remove('open');
    });
  }

  // ═══════════════════════════════════════════
  // LIST VIEW
  // ═══════════════════════════════════════════
  function setupListView() {
    document.getElementById('listToggle').addEventListener('click', () => {
      listViewOpen = !listViewOpen;
      const lv = document.getElementById('listView');
      const btn = document.getElementById('listToggle');
      if (listViewOpen) {
        btn.classList.add('on');
        lv.classList.add('open');
        lv.innerHTML = '';
        const q = document.getElementById('brainSearch').value.toLowerCase().trim();
        const filtered = NX.nodes.filter(n => !n.is_private && (!q ||
          n.name.toLowerCase().includes(q) || (n.tags||[]).some(t=>t.includes(q)) ||
          (n.notes||'').toLowerCase().includes(q)));
        filtered.forEach(n => {
          const el = document.createElement('div');
          el.className = 'list-node';
          el.innerHTML = `<div class="list-node-cat">${n.category}</div><div class="list-node-title">${n.name}</div><div class="list-node-notes">${(n.notes||'').slice(0,120)}</div>`;
          el.onclick = () => { openPanel(n); listViewOpen = false; lv.classList.remove('open'); btn.classList.remove('on'); };
          lv.appendChild(el);
        });
      } else {
        btn.classList.remove('on');
        lv.classList.remove('open');
      }
    });
  }

  // ═══════════════════════════════════════════
  // CONTRACTOR EVENTS (on Brain/AI screen)
  // ═══════════════════════════════════════════
  function setupContractorEvents() {
    const toggle = document.getElementById('eventsToggle');
    const panel = document.getElementById('eventsPanel');
    const close = document.getElementById('eventsClose');
    const addBtn = document.getElementById('eventAddBtn');

    toggle.addEventListener('click', () => {
      panel.classList.toggle('open');
      if (panel.classList.contains('open')) loadEvents();
    });
    close.addEventListener('click', () => panel.classList.remove('open'));
    addBtn.addEventListener('click', addEvent);

    // Set default date to today
    document.getElementById('eventDate').value = NX.today;

    // Populate contractor suggestions from nodes
    populateContractorSuggestions();
  }

  function populateContractorSuggestions() {
    const dl = document.getElementById('contractorSuggest');
    dl.innerHTML = '';
    NX.nodes.filter(n => n.category === 'contractors').forEach(n => {
      const opt = document.createElement('option');
      opt.value = n.name;
      dl.appendChild(opt);
    });
  }

  async function loadEvents() {
    const list = document.getElementById('eventsList');
    list.innerHTML = '<div style="text-align:center;padding:16px;color:var(--faint);font-size:11px">Loading...</div>';
    try {
      const { data } = await NX.sb.from('contractor_events').select('*')
        .gte('event_date', NX.today)
        .order('event_date', { ascending: true })
        .order('event_time', { ascending: true })
        .limit(30);
      contractorEvents = data || [];
    } catch (e) {
      contractorEvents = [];
    }
    renderEvents();
  }

  function renderEvents() {
    const list = document.getElementById('eventsList');
    list.innerHTML = '';
    if (!contractorEvents.length) {
      list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--faint);font-size:11px;line-height:2">No upcoming visits scheduled.<br>Add one above.</div>';
      return;
    }

    let lastDate = '';
    contractorEvents.forEach(ev => {
      // Date separator
      if (ev.event_date !== lastDate) {
        lastDate = ev.event_date;
        const sep = document.createElement('div');
        sep.className = 'event-date-sep';
        const d = new Date(ev.event_date + 'T12:00:00');
        const isToday = ev.event_date === NX.today;
        sep.textContent = isToday ? 'TODAY' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        if (isToday) sep.classList.add('today');
        list.appendChild(sep);
      }

      const el = document.createElement('div');
      el.className = 'event-card';
      const timeStr = ev.event_time ? formatTime(ev.event_time) : '';
      const loc = ev.location ? ev.location.charAt(0).toUpperCase() + ev.location.slice(1) : '';
      el.innerHTML = `
        <div class="event-top">
          <span class="event-contractor">${ev.contractor_name || ''}</span>
          <span class="event-time">${timeStr}</span>
        </div>
        <div class="event-desc">${ev.description || ''}</div>
        <div class="event-bottom">
          <span class="event-loc">${loc}</span>
          <button class="event-done-btn" data-id="${ev.id}">✓ Done</button>
          <button class="event-del-btn" data-id="${ev.id}">✕</button>
        </div>
      `;

      // Done button — marks complete and fires synapse on related contractor node
      el.querySelector('.event-done-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = e.target.dataset.id;
        try { await NX.sb.from('contractor_events').update({ status: 'done' }).eq('id', id); } catch(err) {}
        // Fire synapse on the contractor node
        const contractorNode = NX.nodes.find(n => n.category === 'contractors' &&
          (ev.contractor_name || '').toLowerCase().includes(n.name.toLowerCase().split(' ')[0]));
        if (contractorNode) {
          activatedNodes = new Set([contractorNode.id, ...(contractorNode.links || [])]);
          setTimeout(() => { activatedNodes = new Set(); }, 8000);
        }
        loadEvents();
      });

      // Delete button
      el.querySelector('.event-del-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = e.target.dataset.id;
        try { await NX.sb.from('contractor_events').delete().eq('id', id); } catch(err) {}
        loadEvents();
      });

      // Tap card → fire synapse on that contractor's node
      el.addEventListener('click', () => {
        const contractorNode = NX.nodes.find(n => n.category === 'contractors' &&
          (ev.contractor_name || '').toLowerCase().includes(n.name.toLowerCase().split(' ')[0]));
        if (contractorNode) {
          activatedNodes = new Set([contractorNode.id, ...(contractorNode.links || [])]);
          setTimeout(() => { activatedNodes = new Set(); }, 8000);
        }
      });

      list.appendChild(el);
    });
  }

  function formatTime(t) {
    if (!t) return '';
    const [h, m] = t.split(':');
    const hr = parseInt(h);
    const ampm = hr >= 12 ? 'PM' : 'AM';
    return ((hr % 12) || 12) + ':' + m + ' ' + ampm;
  }

  async function addEvent() {
    const contractor = document.getElementById('eventContractor').value.trim();
    const desc = document.getElementById('eventDesc').value.trim();
    const date = document.getElementById('eventDate').value;
    const time = document.getElementById('eventTime').value;
    const location = document.getElementById('eventLocation').value;

    if (!contractor || !date) return;

    const btn = document.getElementById('eventAddBtn');
    btn.disabled = true; btn.textContent = '...';

    try {
      await NX.sb.from('contractor_events').insert({
        contractor_name: contractor,
        description: desc,
        event_date: date,
        event_time: time || null,
        location: location,
        status: 'scheduled'
      });
      document.getElementById('eventContractor').value = '';
      document.getElementById('eventDesc').value = '';
      document.getElementById('eventTime').value = '';
      loadEvents();

      // Fire synapse on matching contractor node
      const contractorNode = NX.nodes.find(n => n.category === 'contractors' &&
        contractor.toLowerCase().includes(n.name.toLowerCase().split(' ')[0]));
      if (contractorNode) {
        activatedNodes = new Set([contractorNode.id, ...(contractorNode.links || [])]);
        setTimeout(() => { activatedNodes = new Set(); }, 6000);
      }
    } catch (e) {
      console.error('Failed to add event:', e);
    }

    btn.disabled = false; btn.textContent = '+ Schedule';
  }

  // ═══════════════════════════════════════════
  // AI CHAT
  // ═══════════════════════════════════════════
  function setupChat() {
    const input = document.getElementById('chatInput');
    const send = document.getElementById('chatSend');
    const dim = document.getElementById('brainDim');
    const resetBtn = document.getElementById('resetBtn');

    input.addEventListener('input', () => { send.disabled = !input.value.trim(); });
    input.addEventListener('focus', () => dim.classList.add('active'));
    input.addEventListener('blur', () => {
      if (!input.value.trim() && !chatActive) dim.classList.remove('active');
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askAI(); }
    });
    send.addEventListener('click', askAI);
    resetBtn.addEventListener('click', resetChat);

    document.querySelectorAll('.brain-ex').forEach(btn => {
      btn.addEventListener('click', () => {
        input.value = btn.textContent;
        send.disabled = false;
        askAI();
      });
    });
  }

  function resetChat() {
    chatHistory = [];
    chatActive = false;
    document.getElementById('chatMessages').innerHTML = '';
    document.getElementById('brainWelcome').style.display = '';
    document.getElementById('brainExamples').style.display = '';
    document.getElementById('brainDim').classList.remove('active');
    document.getElementById('resetBtn').style.display = 'none';
    activatedNodes = new Set();
  }

  function getSmartContext(question) {
    const q = question.toLowerCase();
    const words = q.split(/\s+/).filter(w => w.length > 2);
    const scored = NX.nodes.map(n => {
      let score = 0;
      const text = (n.name + ' ' + n.category + ' ' + (n.tags || []).join(' ') + ' ' + (n.notes || '')).toLowerCase();
      words.forEach(w => { if (text.includes(w)) score += text.split(w).length - 1; });
      if (n.name.toLowerCase().includes(q)) score += 10;
      return { node: n, score };
    }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);

    const relevant = scored.slice(0, 10).map(s => s.node);
    const index = NX.nodes.filter(n => !n.is_private).map(n => `${n.name} (${n.category})`).join(', ');
    const details = relevant.map(n => `[${n.category}] ${n.name}: ${n.notes}`).join('\n');

    // FIRE SYNAPSE NODES
    activatedNodes = new Set(relevant.map(n => n.id));
    setTimeout(() => { activatedNodes = new Set(); }, 12000);

    // Include upcoming contractor events in context
    let eventsCtx = '';
    if (contractorEvents.length) {
      eventsCtx = '\n\nUPCOMING CONTRACTOR VISITS:\n' + contractorEvents.slice(0, 8).map(ev =>
        `${ev.contractor_name} — ${ev.description || 'visit'} @ ${ev.location || '?'} on ${ev.event_date}${ev.event_time ? ' at ' + formatTime(ev.event_time) : ''}`
      ).join('\n');
    }

    return `RELEVANT NODES:\n${details}\n\nFULL INDEX (${NX.nodes.length} nodes):\n${index}${eventsCtx}`;
  }

  async function askAI() {
    const input = document.getElementById('chatInput');
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    document.getElementById('chatSend').disabled = true;
    document.getElementById('brainWelcome').style.display = 'none';
    document.getElementById('brainExamples').style.display = 'none';
    document.getElementById('brainDim').classList.add('active');
    document.getElementById('resetBtn').style.display = '';
    chatActive = true;

    addBubble(q, 'user');
    chatHistory.push({ role: 'user', content: q });

    const thinkEl = addBubble(`Cross-referencing ${NX.nodes.length} brain nodes...`, 'ai thinking');
    const context = getSmartContext(q);

    const msgs = chatHistory.slice(-6).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content
    }));

    try {
      const answer = await NX.askClaude(PERSONA + '\n\n' + context, msgs, 600);
      thinkEl.textContent = answer || 'Something went sideways. Try again?';
      thinkEl.classList.remove('chat-thinking');
      chatHistory.push({ role: 'assistant', content: answer });
      if (voiceOn) speak(answer);
      try { NX.sb.from('chat_history').insert({ question: q, answer }); } catch (e) { }
    } catch (e) {
      console.error('AI error:', e);
      thinkEl.textContent = e.message || 'Connection hiccup. Try again?';
      thinkEl.classList.remove('chat-thinking');
    }
  }

  function addBubble(text, type) {
    const el = document.createElement('div');
    el.className = 'chat-bubble chat-' + (type.includes('user') ? 'user' : 'ai');
    if (type.includes('thinking')) el.classList.add('chat-thinking');
    el.textContent = text;
    el.style[type.includes('user') ? 'marginLeft' : 'marginRight'] = 'auto';
    const container = document.getElementById('chatMessages');
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    return el;
  }

  // ═══════════════════════════════════════════
  // VOICE (ElevenLabs TTS with browser fallback)
  // ═══════════════════════════════════════════
  let preferredVoice = null;

  function setupVoice() {
    document.getElementById('micBtn').addEventListener('click', toggleMic);
    document.getElementById('voiceBtn').addEventListener('click', () => {
      voiceOn = !voiceOn;
      document.getElementById('voiceBtn').classList.toggle('on', voiceOn);
    });

    // Pre-select best browser voice as fallback
    if ('speechSynthesis' in window) {
      const pickVoice = () => {
        const voices = speechSynthesis.getVoices();
        // Prefer natural / premium voices
        const preferred = [
          'Samantha', 'Karen', 'Daniel', 'Google US English',
          'Microsoft Aria', 'Microsoft Guy', 'Moira', 'Rishi',
          'Google UK English Male', 'Google UK English Female'
        ];
        for (const name of preferred) {
          const v = voices.find(v => v.name.includes(name));
          if (v) { preferredVoice = v; break; }
        }
        if (!preferredVoice && voices.length) {
          // Pick first english voice that isn't the default robotic one
          preferredVoice = voices.find(v => v.lang.startsWith('en') && v.name !== 'Google US English') || voices[0];
        }
      };
      pickVoice();
      speechSynthesis.onvoiceschanged = pickVoice;
    }
  }

  function toggleMic() {
    const btn = document.getElementById('micBtn');
    if (recognition) { recognition.stop(); recognition = null; btn.classList.remove('recording'); return; }
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = e => {
      document.getElementById('chatInput').value = e.results[0][0].transcript;
      document.getElementById('chatSend').disabled = false;
      btn.classList.remove('recording');
      recognition = null;
      askAI();
    };
    recognition.onerror = () => { btn.classList.remove('recording'); recognition = null; };
    recognition.onend = () => { btn.classList.remove('recording'); recognition = null; };
    btn.classList.add('recording');
    recognition.start();
  }

  async function speak(text) {
    const elevenKey = NX.getElevenLabsKey();

    if (elevenKey) {
      // ─── ElevenLabs TTS (nice voice) ───
      try {
        const resp = await fetch('https://api.elevenlabs.io/v1/text-to-speech/pNInz6obpgDQGcFmaJgB', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': elevenKey
          },
          body: JSON.stringify({
            text: text.slice(0, 800),
            model_id: 'eleven_turbo_v2',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0.3,
              use_speaker_boost: true
            }
          })
        });

        if (resp.ok) {
          const blob = await resp.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.play();
          audio.onended = () => URL.revokeObjectURL(url);
          return;
        }
        console.warn('ElevenLabs returned', resp.status, '— falling back to browser voice');
      } catch(e) {
        console.warn('ElevenLabs failed:', e.message, '— falling back to browser voice');
      }
    }

    // ─── Browser TTS fallback (with nicer voice selection) ───
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(0, 600));
    if (preferredVoice) u.voice = preferredVoice;
    u.rate = 0.95;
    u.pitch = 1.0;
    speechSynthesis.speak(u);
  }

  // ─── Register ───
  NX.brain = { init, closePanel, show: () => { resize(); } };
  NX.modules.brain = NX.brain;
  NX.loaded.brain = true;
})();
